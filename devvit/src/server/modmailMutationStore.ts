import type { MutationDeduplication, ClaimResult } from './modmailMutation.ts';

const records = 'mae:modmail:write-claims:v1';
type RecordValue = { readonly fingerprint: string; readonly status: 'pending' | 'applied' };
export type ModmailClaimRedis = {
  hSetNX(key: string, field: string, value: string): Promise<boolean | number>;
  hGet(key: string, field: string): Promise<string | null | undefined>;
  hSet(key: string, fields: Record<string, string>): Promise<number>;
};
type Json = null | boolean | number | string | Json[] | { readonly [key: string]: Json };
const encode = (value: RecordValue): string => JSON.stringify(value);
const decode = (value: string): RecordValue => {
  const raw: Json = JSON.parse(value);
  if (raw === null || Array.isArray(raw) || typeof raw !== 'object') {
    throw new Error('Corrupt Modmail operation record');
  }
  const fingerprint = raw['fingerprint'];
  const status = raw['status'];
  if (typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(fingerprint)
    || (status !== 'pending' && status !== 'applied')) {
    throw new Error('Corrupt Modmail operation claim');
  }
  return { fingerprint, status };
};

// This record is deliberately not deleted after uncertain failures. The
// canonical Bun outbox must reconcile it explicitly before attempting a retry.
export const createModmailClaimStore = (redis: ModmailClaimRedis): MutationDeduplication => ({
  async claim(operationId, fingerprint): Promise<ClaimResult> {
    const acquired = await redis.hSetNX(records, operationId, encode({ fingerprint, status: 'pending' }));
    if (acquired) return 'acquired';
    const previous = await redis.hGet(records, operationId);
    if (previous === null || previous === undefined) throw new Error('Modmail claim vanished');
    const record = decode(previous);
    if (record.fingerprint !== fingerprint) return 'conflict';
    return record.status;
  },
  async complete(operationId, fingerprint): Promise<void> {
    const previous = await redis.hGet(records, operationId);
    if (previous === null || previous === undefined) throw new Error('Modmail claim missing after write');
    const record = decode(previous);
    if (record.fingerprint !== fingerprint || record.status !== 'pending') {
      throw new Error('Modmail claim changed while writing');
    }
    await redis.hSet(records, { [operationId]: encode({ fingerprint, status: 'applied' }) });
  },
});
