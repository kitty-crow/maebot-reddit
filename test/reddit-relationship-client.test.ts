import { expect, test } from 'bun:test';
import { RedditReadClient, type RedditFetch } from '../src/reddit/client.ts';

const auth = {
  clientId: 'synthetic-client',
  clientSecret: 'synthetic-secret',
  username: 'this_is_the_mae',
  password: 'synthetic-password',
  userAgent: 'linux:test:0.0.0 (by /u/this_is_the_mae)',
};

const token = (): Response => new Response(JSON.stringify({
  access_token: 'synthetic-token',
  expires_in: 3600,
}), { status: 200, headers: { 'content-type': 'application/json' } });

const relationshipListing = (username: string): Response => new Response(JSON.stringify({
  data: {
    after: null,
    children: [{
      name: username,
      note: 'Mae enforcement',
      date: 100,
    }],
  },
}), { status: 200, headers: { 'content-type': 'application/json' } });

test('Reddit read client inventories live banned and muted relationships separately', async () => {
  const paths: string[] = [];
  const fetcher: RedditFetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/access_token')) return token();
    paths.push(url.pathname);
    if (url.pathname.endsWith('/about/banned')) return relationshipListing('BannedUser');
    if (url.pathname.endsWith('/about/muted')) return relationshipListing('MutedUser');
    return new Response('{}', { status: 404 });
  };

  const client = new RedditReadClient(auth, { fetcher, sleep: async () => undefined });
  expect((await client.bannedUsers('nyaonearth')).map(row => row.username)).toEqual(['BannedUser']);
  expect((await client.mutedUsers('nyaonearth')).map(row => row.username)).toEqual(['MutedUser']);
  expect(paths).toEqual([
    '/r/nyaonearth/about/banned',
    '/r/nyaonearth/about/muted',
  ]);
});
