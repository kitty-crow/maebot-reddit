import { describe, expect, test } from 'vitest';
import { createModmailClaimStore, type ModmailClaimRedis } from '../src/server/modmailMutationStore.ts';

const fingerprint = 'a'.repeat(64);
const changed = 'b'.repeat(64);
const makeHash = () => {
  const records = new Map<string, string>();
  const redis: ModmailClaimRedis = {
    hSetNX: async (_key, field, value) => {
      if (records.has(field)) return 0;
      records.set(field, value);
      return 1;
    },
    hGet: async (_key, field) => records.get(field) ?? null,
    hSet: async (_key, values) => {
      for (const [field, value] of Object.entries(values)) records.set(field, value);
      return Object.keys(values).length;
    },
  };
  return { records, redis };
};

describe('durable Redis Modmail mutation claims', () => {
  test('only the first request acquires an operation ID', async () => {
    const { redis } = makeHash();
    const store = createModmailClaimStore(redis);
    expect(await store.claim('canonical-123456', fingerprint)).toBe('acquired');
    expect(await store.claim('canonical-123456', fingerprint)).toBe('pending');
    expect(await store.claim('canonical-123456', changed)).toBe('conflict');
  });
  test('retries after success are acknowledged without executing the write again', async () => {
    const { redis } = makeHash();
    const store = createModmailClaimStore(redis);
    await store.claim('canonical-123456', fingerprint);
    await store.complete('canonical-123456', fingerprint);
    expect(await store.claim('canonical-123456', fingerprint)).toBe('applied');
    expect(await store.claim('canonical-123456', changed)).toBe('conflict');
  });
  test('corrupt records fail closed instead of being re-used', async () => {
    const { redis, records } = makeHash();
    const store = createModmailClaimStore(redis);
    records.set('canonical-123456', '{"status":"applied"}');
    await expect(store.claim('canonical-123456', fingerprint)).rejects.toThrow('Corrupt');
    records.set('canonical-123456', 'null');
    await expect(store.claim('canonical-123456', fingerprint)).rejects.toThrow('Corrupt');
  });
  test('refuses to complete an unknown or mismatched claim', async () => {
    const { redis } = makeHash();
    const store = createModmailClaimStore(redis);
    await expect(store.complete('canonical-123456', fingerprint)).rejects.toThrow('missing');
    await store.claim('canonical-123456', fingerprint);
    await expect(store.complete('canonical-123456', changed)).rejects.toThrow('changed');
  });
});
