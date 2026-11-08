import { describe, expect, test } from 'bun:test';
import { DevvitExternalClient, type DevvitExternalFetch } from '../src/reddit/devvitExternal.ts';
import { parseDevvitModerationReceipt, type DevvitModerationRequest } from '../src/reddit/devvitModerationMutation.ts';

const config={baseUrl:'https://this-is-the-mae-abc123-external.devvit.net',
  managedToken:'devvit_at_test_secret_key'};
const request: DevvitModerationRequest={
  subreddit:'catgirlcoin',operationId:'canonical-123456',action:'ban',
  username:'Alice',reason:'Spam',note:'Evidence',
};

describe('Bun-side Devvit moderation transport', () => {
  test('preserves canonical mutation payload and uses the managed auth header', async () => {
    const fetcher: DevvitExternalFetch=async (url,init) => {
      expect(url).toBe(config.baseUrl+'/external/mae/write/moderation');
      expect(init.method).toBe('POST');
      expect(new Headers(init.headers).get('authorization')).toBe('bearer '+config.managedToken);
      expect(JSON.parse(String(init.body))).toEqual(request);
      return new Response(JSON.stringify({protocol:1,operationId:request.operationId,status:'applied'}));
    };
    expect(await new DevvitExternalClient(config,fetcher).mutateModeration(request))
      .toEqual({protocol:1,operationId:request.operationId,status:'applied'});
  });
  test('rejects replay receipts that refer to another canonical operation', () => {
    expect(() => parseDevvitModerationReceipt(JSON.stringify({
      protocol:1,operationId:'different',status:'applied',
    }),request.operationId)).toThrow();
    expect(() => parseDevvitModerationReceipt(JSON.stringify({
      protocol:1,operationId:request.operationId,status:'unknown',
    }),request.operationId)).toThrow();
  });
  test('returns the created flair template ID without changing canonical identity', () => {
    expect(parseDevvitModerationReceipt(JSON.stringify({
      protocol:1,operationId:request.operationId,status:'applied',
      createdTemplateId:'created-uuid',
    }),request.operationId)).toEqual({
      protocol:1,operationId:request.operationId,status:'applied',
      createdTemplateId:'created-uuid',
    });
  });
  test('fails closed without retrying or leaking a provider response body', async () => {
    let attempts=0;
    const fetcher: DevvitExternalFetch=async () => {
      attempts += 1;
      return new Response('secret Reddit diagnostics',{status:409});
    };
    await expect(new DevvitExternalClient(config,fetcher).mutateModeration(request))
      .rejects.toThrow('reconcile before retry');
    expect(attempts).toBe(1);
  });
  test('a network failure leaves the result uncertain, not successful', async () => {
    const fetcher: DevvitExternalFetch=async () => {throw new Error('private provider diagnostic');};
    await expect(new DevvitExternalClient(config,fetcher).mutateModeration(request))
      .rejects.toThrow('outcome uncertain');
  });
});
