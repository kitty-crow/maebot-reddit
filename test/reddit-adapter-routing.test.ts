import { describe, expect, test } from 'bun:test';
import type { RedditAuthCfg } from '../src/env.ts';
import { RedditAdapterClient } from '../src/reddit/adapter.ts';
import { RedditReadClient } from '../src/reddit/client.ts';
import { RedditMutationClient } from '../src/reddit/mutate.ts';

const cfg: RedditAuthCfg = {
  clientId: 'client',
  clientSecret: 'secret',
  username: 'this_is_the_mae',
  password: 'password',
  userAgent: 'test',
};

const adapter = (
  responder: (body: unknown) => object,
): RedditAdapterClient => new RedditAdapterClient(
  { base: 'http://127.0.0.1:7743', token: 'internal' },
  async (_input, init) => new Response(
    JSON.stringify(responder(JSON.parse(String(init?.body ?? 'null')))),
    { status: 200, headers: { 'content-type': 'application/json' } },
  ),
);

describe('hybrid Reddit transport routing', () => {
  test('supported read bypasses OAuth token acquisition entirely', async () => {
    let oauthCalls = 0;
    const read = new RedditReadClient(cfg, {
      fetcher: async () => {
        oauthCalls += 1;
        throw new Error('OAuth must not be called');
      },
      adapter: adapter(body => {
        expect(body).toEqual({ method: 'GET', path: '/api/v1/me' });
        return {
          supported: true,
          status: 200,
          body: {
            id: 'mae',
            name: 'this_is_the_mae',
            created_utc: 1,
            link_karma: 2,
            comment_karma: 3,
          },
        };
      }),
    });

    expect(await read.me()).toEqual({
      id: 'mae',
      name: 'this_is_the_mae',
      createdUtc: 1,
      linkKarma: 2,
      commentKarma: 3,
    });
    expect(oauthCalls).toBe(0);
  });

  test('unsupported read falls through to the untouched OAuth path', async () => {
    const calls: string[] = [];
    const read = new RedditReadClient(cfg, {
      adapter: adapter(() => ({ supported: false })),
      fetcher: async input => {
        const url = String(input);
        calls.push(url);
        if (url.includes('/api/v1/access_token')) {
          return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 });
        }
        if (url.includes('/r/catgirlcoin/comments')) {
          return new Response(JSON.stringify({
            kind: 'Listing',
            data: { after: null, children: [] },
          }), { status: 200 });
        }
        throw new Error(`Unexpected OAuth request ${url}`);
      },
    });

    expect(await read.newComments('catgirlcoin', 25)).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('/api/v1/access_token');
    expect(calls[1]).toContain('/r/catgirlcoin/comments');
  });

  test('supported mutation bypasses OAuth and keeps the old response decoder', async () => {
    let oauthCalls = 0;
    const write = new RedditMutationClient(cfg, {
      fetcher: async () => {
        oauthCalls += 1;
        throw new Error('OAuth must not be called');
      },
      adapter: adapter(body => {
        expect(body).toEqual({
          method: 'POST',
          path: '/api/submit',
          form: {
            api_type: 'json',
            kind: 'self',
            resubmit: 'true',
            sendreplies: 'true',
            sr: 'catgirlcoin',
            text: 'Body',
            title: 'Title',
          },
        });
        return {
          supported: true,
          status: 200,
          body: {
            json: {
              errors: [],
              data: { id: 'abc', name: 't3_abc', url: 'https://reddit.com/abc' },
            },
          },
        };
      }),
    });

    expect(await write.submitSelf('catgirlcoin', 'Title', 'Body')).toEqual({
      id: 'abc',
      fullname: 't3_abc',
      url: 'https://reddit.com/abc',
    });
    expect(oauthCalls).toBe(0);
  });

  test('adapter outage fails closed instead of silently changing identity to OAuth', async () => {
    let oauthCalls = 0;
    const read = new RedditReadClient(cfg, {
      fetcher: async () => {
        oauthCalls += 1;
        throw new Error('OAuth must not be called');
      },
      adapter: new RedditAdapterClient(
        { base: 'http://127.0.0.1:7743', token: 'internal' },
        async () => { throw new Error('adapter unavailable'); },
      ),
    });

    await expect(read.me()).rejects.toThrow('Reddit adapter request failed');
    expect(oauthCalls).toBe(0);
  });

  test('adapter configuration rejects public hosts', () => {
    expect(() => new RedditAdapterClient({
      base: 'https://mae.kittycrow.dev',
      token: 'nope',
    })).toThrow('loopback');
  });
});
