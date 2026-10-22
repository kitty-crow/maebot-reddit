import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RedditInternalHttpServer } from '../src/http/server.ts';
import { ModerationReviewStore } from '../src/mod/review.ts';
import { ModmailMediaService } from '../src/modmail/media/service.ts';
import { ModmailMediaStore } from '../src/modmail/media/store.ts';
import { ModmailReplyOutbox } from '../src/modmail/outbox.ts';
import { ModmailRuntime } from '../src/modmail/runtime.ts';
import { ModmailStore } from '../src/modmail/store.ts';
import type { ModmailConversation } from '../src/modmail/types.ts';
import { QuestionEventStore } from '../src/questions/events.ts';
import type { ReputationUser } from '../src/reputation/store.ts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const conversation = (): ModmailConversation => ({
  id: 'abc123',
  subreddit: 'nyaonearth',
  subject: 'Need help',
  participant: {
    id: 'u1',
    name: 'SomeUser',
    isModerator: false,
    isAdmin: false,
    isParticipant: true,
    isHidden: false,
    isDeleted: false,
  },
  kind: 'sr_user',
  state: 'inprogress',
  isInternal: false,
  isAuto: false,
  lastUpdatedAt: 100,
  messages: [{
    id: 'm1',
    conversationId: 'abc123',
    author: {
      id: 'u1',
      name: 'SomeUser',
      isModerator: false,
      isAdmin: false,
      isParticipant: true,
      isHidden: false,
      isDeleted: false,
    },
    bodyMarkdown: 'Hello moderators',
    createdAt: 100,
    isInternal: false,
    participatingAs: 'participant_user',
  }],
});

const canonicalUser: ReputationUser = {
  username: 'SomeUser',
  points: -4,
  tier: 0,
  status: 'uncivil',
  currentFlairTemplateId: 'uncivil-id',
  currentFlairText: ' ',
  currentFlairCssClass: 'u',
  desiredFlairTemplateId: 'uncivil-id',
  desiredFlairText: ' ',
  immutableModeratorFlair: false,
  needsFlair: false,
  needsReview: false,
  source: 'status-flair',
  seededAt: 1,
};

type ReputationSnapshot = {
  readonly username: string;
  readonly points: number;
  readonly tier: number;
  readonly status: string;
};

const fixture = async (withReputation: boolean, immediate = false) => {
  const root = await mkdtemp(join(tmpdir(), 'mae-internal-modmail-'));
  roots.push(root);
  const modmail = new ModmailStore(join(root, 'modmail.pb'));
  await modmail.sync([conversation()], 100);
  const outbox = new ModmailReplyOutbox(join(root, 'replies.pb'));
  const media = new ModmailMediaService(
    modmail,
    { uploadMedia: async name => `https://reddit-uploaded-media.s3-accelerate.amazonaws.com/${encodeURIComponent(name)}` },
    new ModmailMediaStore(join(root, 'media.pb')),
  );
  const archived: string[] = [];
  let current = conversation();
  let writes = 0;
  const runtime = new ModmailRuntime(
    'nyaonearth',
    {
      modmailConversations: async () => ({ conversations: [current], after: null }),
      modmailConversation: async () => current,
    },
    {
      replyModmail: async (_id, body) => {
        writes += 1;
        const at = Math.floor(Date.now() / 1_000);
        current = {
          ...current,
          lastUpdatedAt: at,
          messages: [...current.messages, {
            id: `m${writes + 1}`,
            conversationId: current.id,
            author: { id: 'mae', name: 'this_is_the_mae', isModerator: true, isAdmin: false, isParticipant: false, isHidden: false, isDeleted: false },
            bodyMarkdown: body,
            createdAt: at,
            isInternal: false,
            participatingAs: 'moderator',
          }],
        };
      },
    },
    modmail,
    outbox,
  );
  const server = new RedditInternalHttpServer(
    { host: '127.0.0.1', port: 0, token: 'secret' },
    new QuestionEventStore(join(root, 'questions.pb')),
    new ModerationReviewStore(join(root, 'reviews.pb')),
    () => undefined,
  );
  server.useModmail(
    modmail,
    outbox,
    media,
    withReputation ? { user: async () => canonicalUser } : null,
    { archiveModmail: async id => { archived.push(id); } },
    immediate ? runtime : null,
  );
  server.start();
  return { server, base: server.address(), outbox, modmail, archived, writes: () => writes };
};

describe('Reddit internal Modmail API', () => {
  test('posts to Reddit during the HTTP request and immediately exposes the reply in Tickets', async () => {
    const { server, base, outbox, writes } = await fixture(false, true);
    const payload = {
      key: 'ticket:session:request-1',
      conversationId: 'abc123',
      platform: 'discord',
      userId: '42',
      handle: 'AliceMod',
      text: 'Immediate answer from Mae Tickets.',
      attachmentIds: [],
    };
    const send = async (): Promise<Response> => await fetch(`${base}/v1/modmail/replies`, {
      method: 'POST',
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    try {
      const first = await send();
      expect(first.status).toBe(200);
      expect(await first.json()).toMatchObject({ queued: true, delivered: true });
      expect(writes()).toBe(1);
      expect(await outbox.pending()).toHaveLength(0);

      const ticket = await fetch(`${base}/v1/modmail/conversations/abc123`, {
        headers: { authorization: 'Bearer secret' },
      });
      const data = await ticket.json() as {
        ticketView: { messages: readonly { bodyMarkdown: string; sender: string; origin: string }[] };
      };
      expect(data.ticketView.messages.at(-1)).toMatchObject({
        bodyMarkdown: 'Immediate answer from Mae Tickets.',
        sender: 'AliceMod',
        origin: 'discord',
      });

      const duplicate = await send();
      expect(duplicate.status).toBe(200);
      expect(await duplicate.json()).toMatchObject({ queued: true, delivered: true });
      expect(writes()).toBe(1);
    } finally {
      server.stop();
    }
  });

  test('returns canonical Reddit data plus the Mae Tickets presentation for NyaOnEarth', async () => {
    const { server, base } = await fixture(true);
    try {
      const response = await fetch(`${base}/v1/modmail/conversations/abc123`, {
        headers: { authorization: 'Bearer secret' },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as {
        conversation: { id: string; participant: { name: string } | null };
        reputation: ReputationSnapshot | null;
        ticketView: {
          participant: string | null;
          subreddit: string;
          state: string;
          messages: readonly { side: string; sender: string; origin: string; bodyMarkdown: string }[];
        };
      };
      expect(body.conversation.id).toBe('abc123');
      expect(body.conversation.participant?.name).toBe('SomeUser');
      expect(body.reputation).toEqual({ username: 'SomeUser', points: -4, tier: 0, status: 'uncivil' });
      expect(Object.keys(body.reputation ?? {}).sort()).toEqual(['points', 'status', 'tier', 'username']);
      expect(body.ticketView.participant).toBe('SomeUser');
      expect(body.ticketView.subreddit).toBe('nyaonearth');
      expect(body.ticketView.state).toBe('inprogress');
      expect(body.ticketView.messages[0]).toMatchObject({
        side: 'participant',
        sender: 'u/SomeUser',
        origin: 'reddit',
        bodyMarkdown: 'Hello moderators',
      });
    } finally {
      server.stop();
    }
  });

  test('presents durable applied cross-platform replies as human moderator messages', async () => {
    const { server, base, outbox, modmail } = await fixture(false);
    try {
      const queued = await outbox.queue({
        key: 'discord:message-1',
        conversationId: 'abc123',
        moderator: { platform: 'discord', userId: '42', handle: '@AliceMod' },
        text: 'Human reply from Discord.',
        createdAt: 200,
      });
      await outbox.markApplied(queued.key, 205);
      await modmail.sync([{
        ...conversation(),
        lastUpdatedAt: 205,
        messages: [
          ...conversation().messages,
          {
            id: 'm2',
            conversationId: 'abc123',
            author: {
              id: 'mae',
              name: 'this_is_the_mae',
              isModerator: true,
              isAdmin: false,
              isParticipant: false,
              isHidden: false,
              isDeleted: false,
            },
            bodyMarkdown: queued.bodyMarkdown,
            createdAt: 205,
            isInternal: false,
            participatingAs: 'moderator',
          },
        ],
      }], 205);

      const response = await fetch(`${base}/v1/modmail/conversations/abc123`, {
        headers: { authorization: 'Bearer secret' },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as {
        ticketView: { messages: readonly { sender: string; origin: string; bodyMarkdown: string }[] };
      };
      expect(body.ticketView.messages[1]).toMatchObject({
        sender: '@AliceMod',
        origin: 'discord',
        bodyMarkdown: 'Human reply from Discord.',
      });
    } finally {
      server.stop();
    }
  });

  test('returns null reputation when reputation service is deliberately unavailable', async () => {
    const { server, base } = await fixture(false);
    try {
      const response = await fetch(`${base}/v1/modmail/conversations/abc123`, {
        headers: { authorization: 'Bearer secret' },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { reputation: ReputationSnapshot | null };
      expect(body.reputation).toBeNull();
    } finally {
      server.stop();
    }
  });

  test('keeps Modmail conversation data and archive mutation behind bearer authentication', async () => {
    const { server, base, archived } = await fixture(true);
    try {
      expect((await fetch(`${base}/v1/modmail/conversations/abc123`)).status).toBe(401);
      const close = await fetch(`${base}/v1/modmail/conversations/abc123/archive`, { method: 'POST' });
      expect(close.status).toBe(401);
      expect(archived).toHaveLength(0);
    } finally {
      server.stop();
    }
  });

  test('archives a Modmail conversation through the canonical mutation writer and treats already archived state as closed', async () => {
    const { server, base, archived, modmail } = await fixture(false);
    try {
      const first = await fetch(`${base}/v1/modmail/conversations/abc123/archive`, {
        method: 'POST',
        headers: { authorization: 'Bearer secret' },
      });
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({ closed: true });
      expect(archived).toEqual(['abc123']);

      await modmail.sync([{ ...conversation(), state: 'archived', lastUpdatedAt: 200 }], 200);
      const second = await fetch(`${base}/v1/modmail/conversations/abc123/archive`, {
        method: 'POST',
        headers: { authorization: 'Bearer secret' },
      });
      expect(second.status).toBe(200);
      expect(await second.json()).toEqual({ closed: true });
      expect(archived).toEqual(['abc123']);
    } finally {
      server.stop();
    }
  });

  test('uploads authenticated media and queues a media-only attributed reply by durable attachment id', async () => {
    const { server, base, outbox } = await fixture(false);
    try {
      const upload = await fetch(`${base}/v1/modmail/media/abc123`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer secret',
          'content-type': 'image/png',
          'x-mae-file-name': 'context.png',
        },
        body: new Uint8Array([1, 2, 3]),
      });
      expect(upload.status).toBe(201);
      const uploadBody = await upload.json() as { attachment: { id: string; url: string } };
      expect(uploadBody.attachment.url).toContain('reddit-uploaded-media.s3-accelerate.amazonaws.com');

      const reply = await fetch(`${base}/v1/modmail/replies`, {
        method: 'POST',
        headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify({
          key: 'discord:media1',
          conversationId: 'abc123',
          platform: 'discord',
          userId: '42',
          handle: '@AliceMod',
          text: '',
          attachmentIds: [uploadBody.attachment.id],
        }),
      });
      expect(reply.status).toBe(202);
      const pending = await outbox.pending();
      expect(pending).toHaveLength(1);
      expect(pending[0]?.attachments).toHaveLength(1);
      expect(pending[0]?.text).toBe('');
      expect(pending[0]?.bodyMarkdown).toContain('**Attachments:**');
      expect(pending[0]?.bodyMarkdown).toContain('context.png');
    } finally {
      server.stop();
    }
  });
});
