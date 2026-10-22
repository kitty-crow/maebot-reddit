import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RedditInternalHttpServer } from '../src/http/server.ts';
import { ModerationReviewStore } from '../src/mod/review.ts';
import { ModmailMediaService } from '../src/modmail/media/service.ts';
import { ModmailMediaStore } from '../src/modmail/media/store.ts';
import { ModmailReplyOutbox } from '../src/modmail/outbox.ts';
import { ModmailStore } from '../src/modmail/store.ts';
import { presentRedditModmailTicket } from '../src/modmail/ticketPresentation.ts';
import type { ModmailConversation } from '../src/modmail/types.ts';
import { QuestionEventStore } from '../src/questions/events.ts';

const roots: string[] = [];
const authorNyaId = 'nya_stable_author_1234567890';

const participant = {
  id: 'u1',
  name: 'SomeUser',
  isModerator: false,
  isAdmin: false,
  isParticipant: true,
  isHidden: false,
  isDeleted: false,
} as const;

const maeModerator = {
  id: 'mae',
  name: 'this_is_the_mae',
  isModerator: true,
  isAdmin: false,
  isParticipant: false,
  isHidden: false,
  isDeleted: false,
} as const;

const conversation = (messages?: ModmailConversation['messages']): ModmailConversation => ({
  id: 'abc123',
  subreddit: 'nyaonearth',
  subject: 'Need help',
  participant,
  kind: 'sr_user',
  state: 'inprogress',
  isInternal: false,
  isAuto: false,
  lastUpdatedAt: 100,
  messages: messages ?? [{
    id: 'm1',
    conversationId: 'abc123',
    author: participant,
    bodyMarkdown: 'Hello moderators',
    createdAt: 100,
    isInternal: false,
    participatingAs: 'participant_user',
  }],
});

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'mae-reddit-nya-authorship-'));
  roots.push(root);
  const modmail = new ModmailStore(join(root, 'modmail.pb'));
  await modmail.sync([conversation()], 100);
  const outbox = new ModmailReplyOutbox(join(root, 'replies.pb'));
  const media = new ModmailMediaService(
    modmail,
    { uploadMedia: async name => `https://reddit-uploaded-media.s3-accelerate.amazonaws.com/${encodeURIComponent(name)}` },
    new ModmailMediaStore(join(root, 'media.pb')),
  );
  const server = new RedditInternalHttpServer(
    { host: '127.0.0.1', port: 0, token: 'secret' },
    new QuestionEventStore(join(root, 'questions.pb')),
    new ModerationReviewStore(join(root, 'reviews.pb')),
    () => undefined,
  );
  server.useModmail(modmail, outbox, media);
  server.start();
  return { root, modmail, outbox, server, base: server.address() };
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('Mae Nya authorship on the Reddit ticket relay', () => {
  test('valid internal reply ingress persists the opaque Nya author separately from platform provenance', async () => {
    const { server, base, outbox } = await fixture();
    try {
      const response = await fetch(`${base}/v1/modmail/replies`, {
        method: 'POST',
        headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify({
          key: 'ticket:session:request',
          conversationId: 'abc123',
          platform: 'discord',
          userId: 'discord-42',
          handle: 'Kitty',
          authorNyaId,
          text: 'Hello from Mae',
          attachmentIds: [],
        }),
      });
      expect(response.status).toBe(202);
      const [queued] = await outbox.pending();
      expect(queued?.moderator).toEqual({ platform: 'discord', userId: 'discord-42', handle: 'Kitty' });
      expect(queued?.authorNyaId).toBe(authorNyaId);

      const reopened = new ModmailReplyOutbox(join(roots[roots.length - 1] ?? '', 'replies.pb'));
      expect((await reopened.pending())[0]?.authorNyaId).toBe(authorNyaId);
    } finally {
      server.stop();
    }
  });

  test('malformed Nya authorship is rejected before it reaches the outbox', async () => {
    const { server, base, outbox } = await fixture();
    try {
      const response = await fetch(`${base}/v1/modmail/replies`, {
        method: 'POST',
        headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify({
          key: 'ticket:session:request',
          conversationId: 'abc123',
          platform: 'discord',
          userId: 'discord-42',
          handle: 'Kitty',
          authorNyaId: '../forged',
          text: 'Hello from Mae',
          attachmentIds: [],
        }),
      });
      expect(response.status).toBe(400);
      expect(await outbox.pending()).toEqual([]);
    } finally {
      server.stop();
    }
  });

  test('the internal JSON boundary rejects oversized chunked bodies without queueing a reply', async () => {
    const { server, base, outbox } = await fixture();
    try {
      const oversized = JSON.stringify({ value: 'x'.repeat(1_000_100) });
      const response = await fetch(`${base}/v1/modmail/replies`, {
        method: 'POST',
        headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            const bytes = new TextEncoder().encode(oversized);
            controller.enqueue(bytes.subarray(0, 600_000));
            controller.enqueue(bytes.subarray(600_000));
            controller.close();
          },
        }),
        duplex: 'half',
      } as RequestInit & { duplex: 'half' });
      expect(response.status).toBe(400);
      expect(await outbox.pending()).toEqual([]);
    } finally {
      server.stop();
    }
  });

  test('presentation returns Nya authorship only for a matched applied Mae relay', async () => {
    const { server, outbox } = await fixture();
    try {
      const queued = await outbox.queue({
        key: 'ticket:session:request',
        conversationId: 'abc123',
        moderator: { platform: 'telegram', userId: 'telegram-77', handle: '@Kitty' },
        authorNyaId,
        text: 'Matched relay text',
        createdAt: 200,
      });
      await outbox.markApplied(queued.key, 205);
      const applied = await outbox.appliedForConversation('abc123');

      const matched = presentRedditModmailTicket(conversation([
        ...conversation().messages,
        {
          id: 'm2',
          conversationId: 'abc123',
          author: maeModerator,
          bodyMarkdown: queued.bodyMarkdown,
          createdAt: 205,
          isInternal: false,
          participatingAs: 'moderator',
        },
      ]), applied);
      expect(matched.messages[1]?.authorNyaId).toBe(authorNyaId);
      expect(matched.messages[1]?.provenance).toEqual({
        userId: 'telegram-77', handle: '@Kitty', app: 'telegram',
      });

      const native = presentRedditModmailTicket(conversation([
        ...conversation().messages,
        {
          id: 'm-native',
          conversationId: 'abc123',
          author: maeModerator,
          bodyMarkdown: 'A native moderator message with no Mae outbox match',
          createdAt: 300,
          isInternal: false,
          participatingAs: 'moderator',
        },
      ]), applied);
      const nativeMessage = native.messages.find(message => message.id === 'm-native');
      expect(nativeMessage?.authorNyaId).toBeUndefined();
      expect(nativeMessage?.origin).toBe('reddit');
      expect(native.messages.some(message => message.id === `mae-confirmed:${queued.key}`)).toBe(true);
    } finally {
      server.stop();
    }
  });

  test('idempotency keys cannot be reused with a different Nya author', async () => {
    const { server, outbox } = await fixture();
    try {
      await outbox.queue({
        key: 'ticket:session:request',
        conversationId: 'abc123',
        moderator: { platform: 'discord', userId: 'discord-42', handle: 'Kitty' },
        authorNyaId,
        text: 'Same text',
      });
      await expect(outbox.queue({
        key: 'ticket:session:request',
        conversationId: 'abc123',
        moderator: { platform: 'discord', userId: 'discord-42', handle: 'Kitty' },
        authorNyaId: 'nya_other_author_0987654321',
        text: 'Same text',
      })).rejects.toThrow('reused with different content');
    } finally {
      server.stop();
    }
  });
});
