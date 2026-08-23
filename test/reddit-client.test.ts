import { describe, expect, test } from 'bun:test';
import { RedditReadClient, type RedditFetch } from '../src/reddit/client.ts';
import { RedditError } from '../src/reddit/error.ts';
import { backoffMs, rateFrom } from '../src/reddit/rate.ts';

const auth = {
  clientId: 'synthetic-client',
  clientSecret: 'synthetic-secret',
  username: 'synthetic-user',
  password: 'synthetic-password',
  userAgent: 'linux:test:0.0.0 (by /u/synthetic-user)',
};

const token = (): Response => new Response(JSON.stringify({ access_token: 'synthetic-token', expires_in: 3600 }), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

describe('Reddit read client', () => {
  test('authenticates once, uses Bearer auth and requests raw_json', async () => {
    const calls: string[] = [];
    const fetcher: RedditFetch = async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/access_token')) return token();
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer synthetic-token');
      expect(new URL(url).searchParams.get('raw_json')).toBe('1');
      return new Response(JSON.stringify({ id: 'u1', name: 'synthetic-user', created_utc: 1, link_karma: 2, comment_karma: 3 }), {
        status: 200,
        headers: { 'x-ratelimit-remaining': '99', 'x-ratelimit-reset': '600' },
      });
    };
    const client = new RedditReadClient(auth, { fetcher, sleep: async () => undefined });
    expect((await client.me()).name).toBe('synthetic-user');
    expect((await client.me()).name).toBe('synthetic-user');
    expect(calls.filter(url => url.includes('/access_token')).length).toBe(1);
    expect(client.rate().remaining).toBe(99);
  });

  test('reauthenticates exactly once after a 401', async () => {
    let tokenCalls = 0;
    let apiCalls = 0;
    const fetcher: RedditFetch = async input => {
      const url = String(input);
      if (url.includes('/access_token')) {
        tokenCalls += 1;
        return token();
      }
      apiCalls += 1;
      if (apiCalls === 1) return new Response('', { status: 401 });
      return new Response(JSON.stringify({ id: 'u1', name: 'synthetic-user' }), { status: 200 });
    };
    const client = new RedditReadClient(auth, { fetcher, sleep: async () => undefined });
    expect((await client.me()).name).toBe('synthetic-user');
    expect(tokenCalls).toBe(2);
    expect(apiCalls).toBe(2);
  });

  test('does not include response bodies or credentials in classified errors', async () => {
    const fetcher: RedditFetch = async input => String(input).includes('/access_token')
      ? token()
      : new Response('secret-bearing server body', { status: 403 });
    const client = new RedditReadClient(auth, { fetcher, sleep: async () => undefined });
    try {
      await client.me();
      throw new Error('expected request to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(RedditError);
      const message = error instanceof Error ? error.message : '';
      expect(message).not.toContain('synthetic-secret');
      expect(message).not.toContain('secret-bearing');
    }
  });

  test('pages accessible contribution history without crediting beyond the requested cap', async () => {
    const apiCalls: URL[] = [];
    const post = (id: string, author: string) => ({
      kind: 't3',
      data: {
        id,
        subreddit: 'catgirlcoin',
        title: `post ${id}`,
        author,
        permalink: `/r/catgirlcoin/comments/${id}/post/`,
        created_utc: 1,
      },
    });
    const fetcher: RedditFetch = async input => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/access_token')) return token();
      apiCalls.push(url);
      const after = url.searchParams.get('after');
      if (after === null) {
        return new Response(JSON.stringify({
          data: { after: 't3_b', children: [post('a', 'one'), post('b', 'two')] },
        }), { status: 200 });
      }
      expect(after).toBe('t3_b');
      return new Response(JSON.stringify({
        data: { after: 't3_d', children: [post('c', 'three'), post('d', 'four')] },
      }), { status: 200 });
    };
    const client = new RedditReadClient(auth, { fetcher, sleep: async () => undefined });
    const items = await client.newPostsHistory('catgirlcoin', 3);
    expect(items.map(item => item.id)).toEqual(['a', 'b', 'c']);
    expect(apiCalls.length).toBe(2);
    expect(apiCalls[0]?.searchParams.get('count')).toBe('0');
    expect(apiCalls[1]?.searchParams.get('count')).toBe('2');
    expect(apiCalls[1]?.searchParams.get('limit')).toBe('1');
  });
});

describe('rate helpers', () => {
  test('parses standard Reddit rate headers', () => {
    const rate = rateFrom(new Headers({
      'x-ratelimit-used': '1',
      'x-ratelimit-remaining': '99',
      'x-ratelimit-reset': '600',
    }));
    expect(rate).toEqual({ used: 1, remaining: 99, resetMs: 600_000 });
  });

  test('bounded backoff can be deterministic in tests', () => {
    expect(backoffMs(0, () => 0)).toBe(375);
    expect(backoffMs(20, () => 1)).toBe(37_500);
  });
});
