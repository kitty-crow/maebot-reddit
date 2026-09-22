import { expect, test } from 'bun:test';
import type { RedditAuthCfg } from '../src/env.ts';
import { MemberModNotesRedditClient } from '../src/modnotes/reddit.ts';
import { RedditReadClient, type RedditFetch } from '../src/reddit/client.ts';
import { RedditMutationClient } from '../src/reddit/mutate.ts';

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


test('legacy transport sends moderation mutations through OAuth instead of Devvit', async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const fetcher: RedditFetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method });
    if (url.includes('/api/v1/access_token')) {
      return new Response(JSON.stringify({
        access_token: 'legacy-token',
        expires_in: 3600,
      }), { status: 200 });
    }
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer legacy-token');
    return new Response(JSON.stringify({ json: { errors: [] } }), { status: 200 });
  };

  const client = new RedditMutationClient(cfg('/tmp/legacy-mutation-should-not-be-consumed.pb'), {
    fetcher,
    sleep: async () => undefined,
  });

  await client.banUser('catgirlcoin', 'example_user', 'reason', 'note');

  expect(calls.some(call => call.url.includes('/r/catgirlcoin/api/friend') && call.method === 'POST')).toBe(true);
});

test('legacy transport keeps native Mod Notes on the existing OAuth path', async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const fetcher: RedditFetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method });
    if (url.includes('/api/v1/access_token')) {
      return new Response(JSON.stringify({
        access_token: 'legacy-token',
        expires_in: 3600,
      }), { status: 200 });
    }
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer legacy-token');
    return new Response(JSON.stringify({
      json: { errors: [] },
      data: { id: 'ModNote_fallback' },
    }), { status: 200 });
  };

  const client = new MemberModNotesRedditClient(
    cfg('/tmp/legacy-modnotes-should-not-be-consumed.pb'),
    { fetcher, sleep: async () => undefined },
  );

  expect(await client.addModNote(
    'catgirlcoin',
    'example_user',
    'Fallback note.',
    'HELPFUL_USER',
    't1_abc',
  )).toBe('ModNote_fallback');

  expect(calls.some(call => call.url.includes('/api/mod/notes') && call.method === 'POST')).toBe(true);
});
