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
import type { ModmailConversation } from '../src/modmail/types.ts';
import { QuestionEventStore } from '../src/questions/events.ts';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const conversation = (): ModmailConversation => ({
  id: 'abc123',
  subreddit: 'catgirlcoin',
  subject: 'Managed files',
  participant: {
    id: 'u1',
    name: 'notKittyCrypto',
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
      name: 'notKittyCrypto',
      isModerator: false,
      isAdmin: false,
      isParticipant: true,
      isHidden: false,
      isDeleted: false,
    },
    bodyMarkdown: 'hello',
    createdAt: 100,
    isInternal: false,
    participatingAs: 'participant_user',
  }],
});

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'mae-reddit-managed-files-'));
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
  return { server, base: server.address(), modmail, outbox };
};

type ManagedAttachmentFixture = {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly kind: 'image' | 'video' | 'file';
  readonly url: string;
  readonly size: number;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly sourceId: string | null;
};

const managed = (overrides: Partial<ManagedAttachmentFixture> = {}): ManagedAttachmentFixture => ({
  id: 'mae-managed-file-0001',
  name: 'diagnostic.zip',
  mimeType: 'application/zip',
  kind: 'file',
  url: 'https://support.example.invalid/mae/tickets/files/opaque-attachment-id/diagnostic.zip',
  size: 1234,
  createdAt: 1_000,
  expiresAt: 1_000 + (24 * 60 * 60),
  sourceId: null,
  ...overrides,
});

const reply = async (base: string, attachment: ManagedAttachmentFixture) => await fetch(`${base}/v1/modmail/replies`, {
  method: 'POST',
  headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
  body: JSON.stringify({
    key: `discord:${crypto.randomUUID()}`,
    conversationId: 'abc123',
    platform: 'discord',
    userId: '42',
    handle: 'lulu',
    text: '',
    attachmentIds: [],
    attachments: [attachment],
  }),
});

describe('Mae-managed attachments at the Reddit boundary', () => {
  test('queues an arbitrary file using Mae public delivery when Reddit has no native object', async () => {
    const { server, base, outbox } = await fixture();
    try {
      const response = await reply(base, managed());
      expect(response.status).toBe(202);
      const pending = await outbox.pending();
      expect(pending).toHaveLength(1);
      const attachment = pending[0]?.attachments[0];
      if (attachment === undefined) throw new Error('Managed attachment was not queued');
      expect(attachment.kind).toBe('file');
      expect(attachment.url).toContain('support.example.invalid/mae/tickets/files/');
      expect(attachment.deliveryUrl).toBe(attachment.url);
      expect(pending[0]?.bodyMarkdown).toContain('📎 diagnostic.zip');
      expect(pending[0]?.bodyMarkdown).toContain('support.example.invalid/mae/tickets/files/');
    } finally {
      server.stop();
    }
  });

  test('uses Reddit native delivery when available but presents only the Mae 24-hour URL back to the ticket', async () => {
    const { server, base, modmail, outbox } = await fixture();
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
      const native = await upload.json() as { attachment: { id: string; url: string } };

      const maeUrl = 'https://support.example.invalid/mae/tickets/files/opaque-mae-image-id/context.png';
      const response = await reply(base, managed({
        id: 'mae-managed-image-0001',
        name: 'context.png',
        mimeType: 'image/png',
        kind: 'image',
        url: maeUrl,
        size: 3,
        sourceId: native.attachment.id,
      }));
      expect(response.status).toBe(202);

      const pending = await outbox.pending();
      expect(pending).toHaveLength(1);
      expect(pending[0]?.attachments[0]?.url).toBe(maeUrl);
      expect(pending[0]?.attachments[0]?.deliveryUrl).toBe(native.attachment.url);
      expect(pending[0]?.bodyMarkdown).toContain(native.attachment.url);
      expect(pending[0]?.bodyMarkdown).not.toContain(maeUrl);

      const queued = pending[0];
      if (queued === undefined) throw new Error('Managed reply was not queued');
      const echoedAt = queued.createdAt + 5;
      await outbox.markApplied(queued.key, echoedAt);
      await modmail.sync([{
        ...conversation(),
        lastUpdatedAt: echoedAt,
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
            createdAt: echoedAt,
            isInternal: false,
            participatingAs: 'moderator',
          },
        ],
      }], echoedAt);

      const view = await fetch(`${base}/v1/modmail/conversations/abc123`, {
        headers: { authorization: 'Bearer secret' },
      });
      expect(view.status).toBe(200);
      const body = await view.json() as {
        ticketView: {
          messages: Array<{
            id: string;
            attachments: Array<{ id: string; url: string; kind: string; expiresAt: number }>;
          }>;
        };
      };
      const relayed = body.ticketView.messages.find(message => message.id === 'm2');
      expect(relayed?.attachments[0]?.id).toBe('mae-managed-image-0001');
      expect(relayed?.attachments[0]?.url).toBe(maeUrl);
      expect(relayed?.attachments[0]?.url).not.toBe(native.attachment.url);
      expect(relayed?.attachments[0]?.kind).toBe('image');
      expect(relayed?.attachments[0]?.expiresAt).toBe(1_000 + (24 * 60 * 60));
    } finally {
      server.stop();
    }
  });

  test('rejects managed metadata that attempts to change the fixed 24-hour lifetime', async () => {
    const { server, base } = await fixture();
    try {
      const response = await reply(base, managed({ expiresAt: 999_999 }));
      expect(response.status).toBe(400);
    } finally {
      server.stop();
    }
  });
});
