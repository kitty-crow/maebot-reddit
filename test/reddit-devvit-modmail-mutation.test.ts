import { describe, expect, test } from 'bun:test';
import { DevvitExternalClient, type DevvitExternalFetch } from '../src/reddit/devvitExternal.ts';
import { validateModmailMutation, parseModmailMutationReceipt } from '../src/reddit/devvitModmailMutation.ts';

const base = { subreddit: 'catgirlcoin', operationId: 'canonical-123456', conversationId: 'abc123' } as const;
const config = { baseUrl: 'https://this-is-the-mae-abc123-external.devvit.net',
  managedToken: 'devvit_at_test_secret_key' };

describe('Devvit Modmail mutation transport', () => {
  test('preserves canonical operation identity and reply options without rewriting them', async () => {
    const request = { ...base, action: 'reply', body: 'Hello', isAuthorHidden: true, isInternal: false } as const;
    const fetcher: DevvitExternalFetch = async (url, init) => {
      expect(url).toBe(config.baseUrl + '/external/mae/write/modmail');
      expect(new Headers(init.headers).get('authorization')).toBe('bearer ' + config.managedToken);
      expect(JSON.parse(String(init.body))).toEqual(request);
      return new Response(JSON.stringify({ protocol: 1, operationId: request.operationId, status: 'applied' }));
    };
    expect(await new DevvitExternalClient(config, fetcher).mutateModmail(request))
      .toEqual({ protocol: 1, operationId: request.operationId, status: 'applied' });
  });
  test('allows documented 3, 7 and 28 day Modmail mute durations', () => {
    for (const numHours of [72, 168, 672] as const) {
      expect(() => validateModmailMutation({ ...base, action: 'mute', numHours })).not.toThrow();
    }
    expect(() => validateModmailMutation({ ...base, action: 'mute', numHours: 24 } as
      Parameters<typeof validateModmailMutation>[0])).toThrow();
  });
  test('validates operation identity and rejects malformed or mismatched receipts', () => {
    expect(() => validateModmailMutation({ ...base, operationId: 'short', action: 'archive' })).toThrow();
    expect(() => parseModmailMutationReceipt(
      JSON.stringify({ protocol: 1, operationId: 'different', status: 'applied' }), base.operationId,
    )).toThrow();
    expect(() => parseModmailMutationReceipt(
      JSON.stringify({ protocol: 1, operationId: base.operationId, status: 'ok' }), base.operationId,
    )).toThrow();
  });
  test('never automatically retries a failed write and keeps error details secret', async () => {
    let attempts = 0;
    const fetcher: DevvitExternalFetch = async () => {
      attempts += 1;
      return new Response('sensitive response body', { status: 409 });
    };
    const client = new DevvitExternalClient(config, fetcher);
    const result = client.mutateModmail({ ...base, action: 'archive' });
    await expect(result).rejects.toThrow('reconcile before retry');
    expect(attempts).toBe(1);
  });
  test('does not expose a token or a response body if the network fails', async () => {
    const fetcher: DevvitExternalFetch = async () => { throw new Error('private network diagnosis'); };
    const client = new DevvitExternalClient(config, fetcher);
    const result = client.mutateModmail({ ...base, action: 'unmute' });
    await expect(result).rejects.toThrow('outcome uncertain');
  });
});
