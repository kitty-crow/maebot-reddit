import { afterEach, describe, expect, test } from 'bun:test';
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

const conversation = (state: ModmailConversation['state'] = 'inprogress'): ModmailConversation => ({
  id: 'abc123',
  subreddit: 'catgirlcoin',
  subject: 'Appeal',
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
  state,
  isInternal: false,
  isAuto: false,
  lastUpdatedAt: state === 'archived' ? 200 : 100,
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
    bodyMarkdown: 'Please review this.',
    createdAt: 100,
    isInternal: false,
    participatingAs: 'participant_user',
  }],
});

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'mae-modmail-terminal-'));
  roots.push(root);
  const store = new ModmailStore(join(root, 'modmail.pb'));
  const outbox = new ModmailReplyOutbox(join(root, 'replies.pb'));
  await store.sync([conversation()], 100);
  const server = new ModmailTerminalServer(
    {
      host: '127.0.0.1',
      port: 0,
      publicBase: 'https://moderation.example/',
      ttlSeconds: 600,
    },
    store,
    outbox,
  );
  server.start();
  servers.push(server);
  return { store, outbox, server, base: server.address() };
};

const localUrl = (base: string, publicUrl: string, action = ''): string => {
  const path = new URL(publicUrl).pathname.replace(/\/$/u, '');
  return `${base}${path}/${action}`;
};

const tokenFrom = (publicUrl: string): string => {
  const parts = new URL(publicUrl).pathname.split('/').filter(Boolean);
  const token = parts.at(-1);
  if (token === undefined) throw new Error('terminal token missing');
  return token;
};

describe('focused Reddit Modmail terminal', () => {
  test('issues a short-lived one-conversation terminal and serves hardened no-store HTML', async () => {
    const { server, base } = await fixture();
    const link = await server.issue('abc123', { platform: 'discord', userId: '42', handle: 'AliceMod' });
    expect(link.url).toStartWith('https://moderation.example/modmail/');

    const response = await fetch(localUrl(base, link.url));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    const body = await response.text();
    expect(body).toContain('Mae · Reddit Modmail');
    expect(body).toContain('Send to Reddit');
  });

  test('streams the canonical conversation and moderator identity over SSE', async () => {
    const { server, base } = await fixture();
    const link = await server.issue('abc123', { platform: 'telegram', userId: '84', handle: 'BobMod' });
    const response = await fetch(localUrl(base, link.url, 'stream'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('x-accel-buffering')).toBe('no');

    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error('SSE response body missing');
    const first = await reader.read();
    const text = new TextDecoder().decode(first.value);
    expect(text).toContain('SomeUser');
    expect(text).toContain('Please review this.');
    expect(text).toContain('BobMod');
    expect(text).toContain('telegram');
    await reader.cancel();
  });

  test('queues an explicitly attributed human reply through the durable outbox', async () => {
    const { outbox, server, base } = await fixture();
    const link = await server.issue('abc123', { platform: 'discord', userId: '42', handle: 'AliceMod' });
    const response = await fetch(localUrl(base, link.url, 'reply'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'request-1234', text: 'I am reviewing your appeal.' }),
    });
    expect(response.status).toBe(202);

    const pending = await outbox.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      conversationId: 'abc123',
      moderator: { platform: 'discord', userId: '42', handle: 'AliceMod' },
      text: 'I am reviewing your appeal.',
    });
    expect(pending[0]?.bodyMarkdown).toContain('Reply from AliceMod via Discord');
  });

  test('closing terminal access does not archive or otherwise close the Reddit conversation', async () => {
    const { store, server, base } = await fixture();
    const link = await server.issue('abc123', { platform: 'discord', userId: '42', handle: 'AliceMod' });
    const token = tokenFrom(link.url);
    const response = await fetch(localUrl(base, link.url, 'close'), { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await store.terminalSession(token)).toBeNull();
    expect((await store.conversation('abc123'))?.state).toBe('inprogress');
    expect((await fetch(localUrl(base, link.url))).status).toBe(404);
  });

  test('archiving the canonical Reddit conversation immediately retires terminal access', async () => {
    const { store, server, base } = await fixture();
    const link = await server.issue('abc123', { platform: 'telegram', userId: '84', handle: 'BobMod' });
    const token = tokenFrom(link.url);
    expect(await store.terminalSession(token)).not.toBeNull();

    await store.sync([conversation('archived')], 200);
    expect(await store.terminalSession(token)).toBeNull();
    expect((await fetch(localUrl(base, link.url))).status).toBe(404);
  });

  test('expired terminal tokens are rejected even if their public URL still exists', async () => {
    const { store, server, base } = await fixture();
    const link = await server.issue('abc123', { platform: 'discord', userId: '42', handle: 'AliceMod' });
    const token = tokenFrom(link.url);
    expect(await store.terminalSession(token, link.expiresAt - 1)).not.toBeNull();
    expect(await store.terminalSession(token, link.expiresAt + 1)).toBeNull();
    expect((await fetch(localUrl(base, link.url))).status).toBe(404);
  });

  test('cannot issue a terminal for an unknown or archived conversation', async () => {
    const { store, server } = await fixture();
    await expect(server.issue('doesnotexist', { platform: 'discord', userId: '42', handle: 'AliceMod' })).rejects.toThrow('Unknown');
    await store.sync([conversation('archived')], 200);
    await expect(server.issue('abc123', { platform: 'discord', userId: '42', handle: 'AliceMod' })).rejects.toThrow('archived');
  });
});