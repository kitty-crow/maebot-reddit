import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModmailAuditStore } from '../src/modmail/auditStore.ts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const fixture = async (): Promise<ModmailAuditStore> => {
  const root = await mkdtemp(join(tmpdir(), 'mae-modmail-audit-'));
  roots.push(root);
  return new ModmailAuditStore(join(root, 'audit.pb'));
};

describe('private modmail audit store', () => {
  test('persists OpenAI conversation identity before advancing the relay cursor', async () => {
    const store = await fixture();
    expect(await store.cursor()).toBe(0);
    await store.rememberConversation('abc', 'conv_123');
    expect(await store.conversation('abc')).toMatchObject({
      conversationId: 'abc',
      openaiConversationId: 'conv_123',
      lastSequence: 0,
    });

    await store.advance(1, 'abc', 'm1', null);
    expect(await store.cursor()).toBe(1);
    expect(await store.conversation('abc')).toMatchObject({
      openaiConversationId: 'conv_123',
      lastSequence: 1,
      lastMessageId: 'm1',
    });
  });

  test('cursor advancement is strictly sequential so failed events cannot be skipped', async () => {
    const store = await fixture();
    await expect(store.advance(2, 'abc', 'm2', null)).rejects.toThrow('cannot skip');
    expect(await store.cursor()).toBe(0);
    await store.advance(1, 'abc', 'm1', null);
    await store.advance(2, 'abc', 'm2', 'conv_456');
    expect(await store.cursor()).toBe(2);
    expect((await store.conversation('abc'))?.openaiConversationId).toBe('conv_456');
  });
});
