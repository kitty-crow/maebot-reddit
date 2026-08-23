import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  subject: 'Preview test',
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
  messages: [],
};

test('focused Modmail preview runs locally before any public HTTPS base is configured', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mae-modmail-preview-'));
  roots.push(root);
  const store = new ModmailStore(join(root, 'modmail.pb'));
  await store.sync([conversation], 100);
  const server = new ModmailTerminalServer(
    { host: '127.0.0.1', port: 0, publicBase: null, ttlSeconds: 600 },
    store,
    new ModmailReplyOutbox(join(root, 'outbox.pb')),
  );
  server.start();
  servers.push(server);

  const preview = await fetch(server.previewAddress());
  expect(preview.status).toBe(200);
  expect(await preview.text()).toContain('Synthetic read-only preview');
  await expect(server.issue('abc123', {
    platform: 'telegram',
    userId: '42',
    handle: '@moderator',
  })).rejects.toThrow('public base');
});
