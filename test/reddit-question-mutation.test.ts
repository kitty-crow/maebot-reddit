import { describe, expect, test } from 'bun:test';
import { RedditMutationClient, type RedditMutationFetch } from '../src/reddit/mutate.ts';

const auth = {
  clientId: 'synthetic-client',
  clientSecret: 'synthetic-secret',
  username: 'synthetic-user',
  password: 'synthetic-password',
  userAgent: 'linux:test:0.0.0 (by /u/synthetic-user)',
};

const token = (): Response => new Response(JSON.stringify({
  access_token: 'synthetic-token',
  expires_in: 3600,
}), { status: 200, headers: { 'content-type': 'application/json' } });

const comment = (): Response => new Response(JSON.stringify({
  json: {
    errors: [],
    data: {
      things: [{
        kind: 't1',
        data: {
          id: 'mae123',
          name: 't1_mae123',
          permalink: '/r/nyaonearth/comments/post123/question/mae123/',
        },
      }],
    },
  },
}), { status: 200, headers: { 'content-type': 'application/json' } });

describe('Reddit question workflow mutations', () => {
  test('creates a comment and exposes its durable Reddit identity', async () => {
    const fetcher: RedditMutationFetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/access_token')) return token();
      expect(url.pathname).toBe('/api/comment');
      const form = new URLSearchParams(String(init?.body ?? ''));
      expect(form.get('thing_id')).toBe('t3_post123');
      expect(form.get('text')).toBe('Mae synthetic reply');
      return comment();
    };
    const client = new RedditMutationClient(auth, { fetcher, sleep: async () => undefined });
    expect(await client.reply('t3_post123', 'Mae synthetic reply')).toEqual({
      id: 'mae123',
      fullname: 't1_mae123',
      permalink: '/r/nyaonearth/comments/post123/question/mae123/',
    });
  });

  test('locks, unlocks, deletes and distinguishes only validated Reddit things', async () => {
    const requests: Array<readonly [string, URLSearchParams]> = [];
    const fetcher: RedditMutationFetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/access_token')) return token();
      requests.push([url.pathname, new URLSearchParams(String(init?.body ?? ''))]);
      return new Response('', { status: 200 });
    };
    const client = new RedditMutationClient(auth, { fetcher, sleep: async () => undefined });

    await client.lock('t3_post123');
    await client.unlock('t3_post123');
    await client.deleteContent('t1_mae123');
    await client.distinguish('t1_ack123', true);

    expect(requests.map(([path]) => path)).toEqual([
      '/api/lock',
      '/api/unlock',
      '/api/del',
      '/api/distinguish',
    ]);
    expect(requests[0]?.[1].get('id')).toBe('t3_post123');
    expect(requests[1]?.[1].get('id')).toBe('t3_post123');
    expect(requests[2]?.[1].get('id')).toBe('t1_mae123');
    expect(requests[3]?.[1].get('id')).toBe('t1_ack123');
    expect(requests[3]?.[1].get('how')).toBe('yes');
    expect(requests[3]?.[1].get('sticky')).toBe('true');

    await expect(client.lock('post123')).rejects.toThrow();
    await expect(client.unlock('t4_message')).rejects.toThrow();
    await expect(client.deleteContent('t3_post123')).rejects.toThrow();
    await expect(client.distinguish('t3_post123')).rejects.toThrow();
  });
});
