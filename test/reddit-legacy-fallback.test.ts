import { describe, expect, test } from 'bun:test';
import type { RedditAuthCfg } from '../src/env.ts';
import { RedditReadClient } from '../src/reddit/client.ts';
import { LegacyRedditApi } from '../src/reddit/legacyApi.ts';
import { RedditMutationClient } from '../src/reddit/mutate.ts';

const legacy = {
  clientId: 'client',
  clientSecret: 'secret',
  password: 'password',
  userAgent: 'test-agent',
};

const auth = (transport?: 'legacy'): RedditAuthCfg => ({
  username: 'this_is_the_mae',
  devvitRpcStateFile: '/tmp/mae-legacy-api-test.pb',
  devvitRpcTimeoutMs: 1_000,
  legacyOauth: legacy,
  ...(transport === undefined ? {} : { transport }),
});

const token = (value = 'token'): Response => new Response(JSON.stringify({
  access_token: value,
  expires_in: 3600,
}), { status: 200, headers: { 'content-type': 'application/json' } });

describe('legacy Reddit fallback', () => {
  test('caches OAuth and reauthenticates once after a 401', async () => {
    let tokenCalls = 0;
    let apiCalls = 0;
    const client = new LegacyRedditApi('this_is_the_mae', legacy, async input => {
      const url = String(input);
      if (url.includes('/api/v1/access_token')) {
        tokenCalls += 1;
        return token(`token-${tokenCalls}`);
      }
      apiCalls += 1;
      if (apiCalls === 2) return new Response('', { status: 401 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    expect(await client.get('/api/test')).toEqual({ ok: true });
    expect(await client.get('/api/test')).toEqual({ ok: true });
    expect(tokenCalls).toBe(2);
    expect(apiCalls).toBe(3);
  });

  test('DM reply and read state preserve the existing Reddit API paths', async () => {
    const paths: string[] = [];
    const writer = new RedditMutationClient(auth(), {
      fetcher: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/access_token')) return token();
        paths.push(`${init?.method ?? 'GET'} ${url.pathname}`);
        return new Response('{}', { status: 200 });
      },
    });

    await writer.replyToPrivateMessage('t4_abc', 'hello');
    await writer.markPrivateMessageRead('t4_abc');
    expect(paths).toEqual(['POST /api/comment', 'POST /api/read_message']);
  });

  test('ordinary fallback-capability reads do not require legacy transport selection', async () => {
    const paths: string[] = [];
    const reader = new RedditReadClient(auth(), {
      fetcher: async input => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/access_token')) return token();
        paths.push(url.pathname);
        return new Response(JSON.stringify({
          data: { after: null, children: [] },
        }), { status: 200 });
      },
    });

    expect(await reader.newComments('catgirlcoin', 25)).toEqual([]);
    expect(paths).toEqual(['/r/catgirlcoin/comments']);
  });
});
