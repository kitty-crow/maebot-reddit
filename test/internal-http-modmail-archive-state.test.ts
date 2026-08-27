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
import type { ModmailConversation, ModmailMessage } from '../src/modmail/types.ts';
import { QuestionEventStore } from '../src/questions/events.ts';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const participant = {
  id: 'u1',
  name: 'SomeUser',
  isModerator: false,
  isAdmin: false,
  isParticipant: true,
  isHidden: false,
  isDeleted: false,
} as const;

const participantMessage = (id: string, bodyMarkdown: string, createdAt: number): ModmailMessage => ({
  id,
  conversationId: 'abc123',
  author: participant,
  bodyMarkdown,
  createdAt,
  isInternal: false,
  participatingAs: 'participant_user',
});

const conversation = (
  state: ModmailConversation['state'] = 'inprogress',
  messages: readonly ModmailMessage[] = [participantMessage('m1', 'Hello moderators', 100)],
): ModmailConversation => ({
  id: 'abc123',
  subreddit: 'nyaonearth',
  subject: 'Need help',
  participant,
  kind: 'sr_user',
  state,
  isInternal: false,
  isAuto: false,
  lastUpdatedAt: messages.at(-1)?.createdAt ?? 100,
  messages,
});

const reply = (base: string, key: string): Promise<Response> => fetch(`${base}/v1/modmail/replies`, {
  method: 'POST',
  headers: {
    authorization: 'Bearer secret',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    key,
    conversationId: 'abc123',
    platform: 'discord',
    userId: '42',
    handle: '@AliceMod',
    text: 'Moderator reply',
    attachmentIds: [],
  }),
});

describe('Reddit internal Modmail archive state', () => {
  test('blocks fallback replies immediately after archive and permits a later participant revival', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mae-modmail-archive-state-'));
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
      null,
      { archiveModmail: async id => { archived.push(id); } },
    );
    server.start();

    try {
      const base = server.address();
      const close = await fetch(`${base}/v1/modmail/conversations/abc123/archive`, {
        method: 'POST',
        headers: { authorization: 'Bearer secret' },
      });
      expect(close.status).toBe(200);
      expect(archived).toEqual(['abc123']);
      expect((await modmail.conversation('abc123'))?.state).toBe('archived');

      const blocked = await reply(base, 'discord:after-close');
      expect(blocked.status).toBe(409);
      expect(await outbox.pending()).toHaveLength(0);

      const secondClose = await fetch(`${base}/v1/modmail/conversations/abc123/archive`, {
        method: 'POST',
        headers: { authorization: 'Bearer secret' },
      });
      expect(secondClose.status).toBe(200);
      expect(archived).toEqual(['abc123']);

      const revivedMessages = [
        participantMessage('m1', 'Hello moderators', 100),
        participantMessage('m2', 'I still need help', 200),
      ];
      await modmail.sync([conversation('inprogress', revivedMessages)], 200);
      expect((await modmail.conversation('abc123'))?.state).toBe('inprogress');

      const accepted = await reply(base, 'discord:after-revival');
      expect(accepted.status).toBe(202);
      expect(await outbox.pending()).toHaveLength(1);
    } finally {
      server.stop();
    }
  });
});
