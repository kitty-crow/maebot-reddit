import { expect, test } from 'bun:test';
import type { RedditAuthCfg } from '../src/env.ts';
import { RedditReadClient, type RedditFetch } from '../src/reddit/client.ts';

const cfg = (stateFile: string): RedditAuthCfg => ({
  username: 'this_is_the_mae',
  devvitRpcStateFile: stateFile,
  devvitRpcTimeoutMs: 50,
  transport: 'legacy',
  legacyOauth: {
    clientId: 'legacy-client',
    clientSecret: 'legacy-secret',
    password: 'legacy-password',
    userAgent: 'linux:test:0.0.0 (by /u/this_is_the_mae)',
  },
});

test('explicit legacy transport keeps supported reads off the Devvit RPC queue', async () => {
  const calls: string[] = [];
  const fetcher: RedditFetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/api/v1/access_token')) {
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toStartWith('Basic ');
      return new Response(JSON.stringify({
        access_token: 'legacy-token',
        expires_in: 3600,
      }), { status: 200 });
    }
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer legacy-token');
    expect(new URL(url).searchParams.get('raw_json')).toBe('1');
    return new Response(JSON.stringify({
      id: 'mae',
      name: 'this_is_the_mae',
      created_utc: 1,
      link_karma: 2,
      comment_karma: 3,
    }), { status: 200 });
  };

  const client = new RedditReadClient(cfg('/tmp/legacy-transport-should-not-be-consumed.pb'), {
    fetcher,
    sleep: async () => undefined,
  });

  expect(await client.me()).toEqual({
    id: 'mae',
    name: 'this_is_the_mae',
    createdUtc: 1,
    linkKarma: 2,
    commentKarma: 3,
  });
  expect(calls.some(url => url.includes('/api/v1/access_token'))).toBe(true);
  expect(calls.some(url => url.includes('/api/v1/me'))).toBe(true);
});
