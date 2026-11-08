import { describe, expect, test } from 'vitest';
import { executeModmailMutation, parseModmailMutation,
  type ModmailMutationApi, type MutationDeduplication } from '../src/server/modmailMutation.ts';

const subreddit = 'catgirlcoin';
const conversationId = 'abc123';
const operationId = 'canonical-123456';
const identity = { conversation: { id: conversationId, subreddit: { displayName: subreddit } } };
const makeApi = (calls: string[]): ModmailMutationApi => ({
  getConversation: async ({ markRead }) => {
    expect(markRead).toBe(false);
    calls.push('read');
    return identity;
  },
  reply: async input => {
    expect(input).toEqual({ conversationId, body: 'Hello', isAuthorHidden: true, isInternal: false });
    calls.push('reply');
    return identity;
  },
  archiveConversation: async () => {
    calls.push('archive');
    return identity;
  },
  muteConversation: async input => {
    expect(input.numHours).toBe(168);
    calls.push('mute');
    return identity;
  },
  unmuteConversation: async () => {
    calls.push('unmute');
    return identity;
  },
});
const makeStore = (): MutationDeduplication => {
  const values = new Map<string, { fingerprint: string; status: 'pending' | 'applied' }>();
  return {
    claim: async (id, fingerprint) => {
      const prior = values.get(id);
      if (prior === undefined) {
        values.set(id, { fingerprint, status: 'pending' });
        return 'acquired';
      }
      if (prior.fingerprint !== fingerprint) return 'conflict';
      return prior.status;
    },
    complete: async (id, fingerprint) => {
      values.set(id, { fingerprint, status: 'applied' });
    },
  };
};
const base = { subreddit, conversationId, operationId };

describe('Devvit Modmail mutation and deduplication', () => {
  test('rejects extraneous fields, missing visibility, invalid body, and arbitrary subreddits', () => {
    expect(() => parseModmailMutation({ ...base, action: 'archive', body: 'hidden' })).toThrow();
    expect(() => parseModmailMutation({ ...base, action: 'reply', body: 'Hello' })).toThrow();
    expect(() => parseModmailMutation({ ...base, action: 'reply', body: '   ', isAuthorHidden: true, isInternal: false })).toThrow();
    expect(() => parseModmailMutation({ ...base, action: 'mute', numHours: 24 })).toThrow();
    expect(() => parseModmailMutation({ ...base, action: 'archive', subreddit: 'other' })).toThrow();
  });
  test('acknowledges the first write and never duplicates a repeated canonical operation', async () => {
    const calls: string[] = [];
    const api = makeApi(calls);
    const store = makeStore();
    const request = parseModmailMutation({ ...base, action: 'reply', body: 'Hello', isAuthorHidden: true, isInternal: false });
    expect((await executeModmailMutation(request, api, store)).status).toBe('applied');
    expect((await executeModmailMutation(request, api, store)).status).toBe('already-applied');
    expect(calls).toEqual(['read', 'reply', 'read']);
  });
  test('does not accept an operation ID with different content', async () => {
    const api = makeApi([]);
    const store = makeStore();
    await executeModmailMutation(parseModmailMutation({ ...base, action: 'archive' }), api, store);
    await expect(executeModmailMutation(parseModmailMutation({ ...base, action: 'unmute' }), api, store))
      .rejects.toThrow('reused');
  });
  test('keeps an ambiguous write permanently pending and does not send it a second time', async () => {
    const calls: string[] = [];
    const api = makeApi(calls);
    const store = makeStore();
    const request = parseModmailMutation({ ...base, action: 'reply', body: 'Hello', isAuthorHidden: true, isInternal: false });
    const badApi = { ...api, reply: async () => { calls.push('failed-write'); throw new Error('network'); } };
    await expect(executeModmailMutation(request, badApi, store)).rejects.toThrow('network');
    await expect(executeModmailMutation(request, api, store)).rejects.toThrow('reconciliation');
    expect(calls).toEqual(['read', 'failed-write', 'read']);
  });
  test('checks a conversation belongs to the installed community before claiming', async () => {
    const store = makeStore();
    const api = { ...makeApi([]), getConversation: async () => ({
      conversation: { id: conversationId, subreddit: { displayName: 'nyaonearth' } },
    }) };
    await expect(executeModmailMutation(parseModmailMutation({ ...base, action: 'archive' }), api, store))
      .rejects.toThrow('mismatch');
  });
  test('preserves mute duration and accepts native archive and unmute methods', async () => {
    const calls: string[] = [];
    const api = makeApi(calls);
    const store = makeStore();
    for (const [action, suffix] of [['mute', 'a'], ['archive', 'b'], ['unmute', 'c']] as const) {
      const data = action === 'mute'
        ? { ...base, operationId: operationId + suffix, action, numHours: 168 }
        : { ...base, operationId: operationId + suffix, action };
      expect((await executeModmailMutation(parseModmailMutation(data), api, store)).status).toBe('applied');
    }
    expect(calls).toEqual(['read', 'mute', 'read', 'archive', 'read', 'unmute']);
  });
});
