import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModmailMediaService } from '../src/modmail/media/service.ts';
import { ModmailMediaStore } from '../src/modmail/media/store.ts';
import { ModmailReplyOutbox } from '../src/modmail/outbox.ts';
import { ModmailStore } from '../src/modmail/store.ts';
import { ModmailTerminalServer } from '../src/modmail/terminalServer.ts';
import type { ModmailConversation } from '../src/modmail/types.ts';

const roots: string[] = [];
const servers: ModmailTerminalServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) server.stop();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const conversation: ModmailConversation = {
  id: 'abc123',
  subreddit: 'catgirlcoin',
  subject: 'Media',
  participant: {
    id: 'u1', name: 'SomeUser', isModerator: false, isAdmin: false,
    isParticipant: true, isHidden: false, isDeleted: false,
  },
  kind: 'sr_user',
  state: 'inprogress',
  isInternal: false,
  isAuto: false,
  lastUpdatedAt: 100,
  messages: [{
    id: 'm1', conversationId: 'abc123',
    author: {
      id: 'u1', name: 'SomeUser', isModerator: false, isAdmin: false,
      isParticipant: true, isHidden: false, isDeleted: false,
    },
    bodyMarkdown: 'Hello', createdAt: 100, isInternal: false, participatingAs: 'participant_user',
  }],
};

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'mae-terminal-media-'));
  roots.push(root);
  const store = new ModmailStore(join(root, 'modmail.pb'));
  const outbox = new ModmailReplyOutbox(join(root, 'replies.pb'));
  await store.sync([conversation], 100);
  const uploadedNames: string[] = [];
  const media = new ModmailMediaService(
    store,
    {
      uploadMedia: async name => {
        uploadedNames.push(name);
        return `https://reddit-uploaded-media.s3-accelerate.amazonaws.com/${encodeURIComponent(name)}`;
      },
    },
    new ModmailMediaStore(join(root, 'media.pb')),
  );
  const server = new ModmailTerminalServer(
    { host: '127.0.0.1', port: 0, publicBase: 'https://moderation.example/', ttlSeconds: 600 },
    store,
    outbox,
    media,
  );
  server.start();
  servers.push(server);
  const link = await server.issue('abc123', { platform: 'discord', userId: '42', handle: '@AliceMod' });
  const token = new URL(link.url).pathname.split('/').filter(Boolean).at(-1);
  if (token === undefined) throw new Error('terminal token missing');
  const base = `${server.address()}/modmail/${token}`;
  return { base, outbox, uploadedNames };
};

test('focused terminal token uploads media with decoded filename and queues a media-only reply by attachment id', async () => {
  const { base, outbox, uploadedNames } = await fixture();
  const upload = await fetch(`${base}/media`, {
    method: 'POST',
    headers: {
      'content-type': 'image/png',
      'x-mae-file-name': encodeURIComponent('context image.png'),
    },
    body: new Uint8Array([1, 2, 3]),
  });
  expect(upload.status).toBe(201);
  const body = await upload.json() as { attachment: { id: string; name: string } };
  expect(body.attachment.name).toBe('context image.png');
  expect(uploadedNames).toEqual(['context image.png']);

  const reply = await fetch(`${base}/reply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: 'request-media-123', text: '', attachmentIds: [body.attachment.id] }),
  });
  expect(reply.status).toBe(202);
  const pending = await outbox.pending();
  expect(pending).toHaveLength(1);
  expect(pending[0]?.attachments[0]?.name).toBe('context image.png');
  expect(pending[0]?.bodyMarkdown).toContain('**Attachments:**');
});

test('focused terminal preview CSP permits its synthetic data image but media upload remains token-only', async () => {
  const { base } = await fixture();
  const previewBase = base.slice(0, base.indexOf('/modmail/'));
  const preview = await fetch(`${previewBase}/preview/`);
  expect(preview.status).toBe(200);
  expect(preview.headers.get('content-security-policy')).toContain('img-src');
  expect(preview.headers.get('content-security-policy')).toContain('data:');
  expect((await fetch(`${previewBase}/preview/media`, { method: 'POST', body: new Uint8Array([1]) })).status).toBe(404);
});
