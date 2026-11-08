import { redis } from '@devvit/web/server';
import type { MutationDeduplication, ClaimResult } from './modmailMutation.ts';

const records = 'mae:modmail:write-claims:v1';
type RecordValue = { readonly fingerprint: string; readonly status: 'pending' | 'applied' };
const encode = (value: RecordValue): string => JSON.stringify(value);
const decode = (value: string): RecordValue => {
  const parsed: RecordValue = JSON.parse(value);
  if (!/^[a-f0-9]{64}$/u.test(parsed.fingerprint)
    || (parsed.status !== 'pending' && parsed.status !== 'applied')) {
    throw new Error('Corrupt Modmail operation claim');
  }
  return parsed;
};

// Never delete a pending claim automatically. An uncertain write needs a human
// or explicit read-back reconciliation; retrying could duplicate a reply.
export const modmailClaimStore: MutationDeduplication = {
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
};
