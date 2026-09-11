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

const flairListing = (username: string): Response => new Response(JSON.stringify({
  users: [{
    user: username,
    flair_text: 'Trusted Member',
    flair_css_class: 'trusted',
    flair_template_id: 'trusted-id',
  }],
  next: null,
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

test('Reddit read client targets one user without enumerating relationship or flair inventories', async () => {
  const requests: URL[] = [];
  const fetcher: RedditFetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/access_token')) return token();
    requests.push(url);
    if (url.pathname.endsWith('/about/banned')) return relationshipListing('Zeuve');
    if (url.pathname.endsWith('/about/muted')) return relationshipListing('Zeuve');
    if (url.pathname.endsWith('/api/flairlist')) return flairListing('Zeuve');
    return new Response('{}', { status: 404 });
  };

  const client = new RedditReadClient(auth, { fetcher, sleep: async () => undefined });
  expect((await client.bannedUser('catgirlcoin', 'Zeuve'))?.username).toBe('Zeuve');
  expect((await client.mutedUser('catgirlcoin', 'Zeuve'))?.username).toBe('Zeuve');
  expect((await client.userFlairAssignment('catgirlcoin', 'Zeuve'))?.templateId).toBe('trusted-id');

  expect(requests).toHaveLength(3);
  expect(requests[0]?.pathname).toBe('/r/catgirlcoin/about/banned');
  expect(requests[0]?.searchParams.get('user')).toBe('Zeuve');
  expect(requests[0]?.searchParams.get('limit')).toBe('1');
  expect(requests[1]?.pathname).toBe('/r/catgirlcoin/about/muted');
  expect(requests[1]?.searchParams.get('user')).toBe('Zeuve');
  expect(requests[1]?.searchParams.get('limit')).toBe('1');
  expect(requests[2]?.pathname).toBe('/r/catgirlcoin/api/flairlist');
  expect(requests[2]?.searchParams.get('name')).toBe('Zeuve');
  expect(requests[2]?.searchParams.get('limit')).toBe('1');
});
