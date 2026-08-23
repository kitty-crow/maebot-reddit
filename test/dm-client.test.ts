import { expect, test } from 'bun:test';
import { RedditReadClient, type RedditFetch } from '../src/reddit/client.ts';
import { RedditMutationClient, type RedditMutationFetch } from '../src/reddit/mutate.ts';

const auth = {
  clientId: 'synthetic-client',
  clientSecret: 'synthetic-secret',
  username: 'this_is_the_mae',
  password: 'synthetic-password',
  userAgent: 'linux:test:0.0.0 (by /u/this_is_the_mae)',
};

const token = (): Response => new Response(JSON.stringify({ access_token: 'synthetic-token', expires_in: 3600 }), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

const listing = (): Response => new Response(JSON.stringify({
  data: {
    after: null,
    children: [{
      kind: 't4',
      data: {
        id: 'abc',
        name: 't4_abc',
        author: 'SomeUser',
        dest: 'this_is_the_mae',
        subject: 'Hello',
        body: 'Hi Mae',
        created_utc: 100,
        parent_id: null,
        first_message_name: null,
        new: true,
        was_comment: false,
      },
    }],
  },
}), { status: 200 });

test('Reddit read client owns documented inbox, unread and sent DM listings', async () => {
  const paths: string[] = [];
  const fetcher: RedditFetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/access_token')) return token();
    paths.push(url.pathname);
    return listing();
  };
  const client = new RedditReadClient(auth, { fetcher, sleep: async () => undefined });
  expect((await client.inboxDirectMessages()).map(item => item.fullname)).toEqual(['t4_abc']);
  expect((await client.unreadDirectMessages()).map(item => item.fullname)).toEqual(['t4_abc']);
  expect((await client.directMessageHistory()).map(item => item.fullname)).toEqual(['t4_abc']);
  expect((await client.sentDirectMessages()).map(item => item.fullname)).toEqual(['t4_abc']);
  expect(paths).toEqual(['/message/inbox', '/message/unread', '/message/inbox', '/message/sent']);
});

test('Reddit mutation client replies to and marks an exact t4 message read', async () => {
  const requests: Array<{ readonly path: string; readonly body: string }> = [];
  const fetcher: RedditMutationFetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/access_token')) return token();
    requests.push({ path: url.pathname, body: String(init?.body ?? '') });
    return new Response('{}', { status: 200 });
  };
  const client = new RedditMutationClient(auth, { fetcher, sleep: async () => undefined });
  await client.replyToPrivateMessage('t4_abc', 'Hello from Mae');
  await client.markPrivateMessageRead('t4_abc');

  expect(requests.map(value => value.path)).toEqual(['/api/comment', '/api/read_message']);
  const reply = new URLSearchParams(requests[0]?.body ?? '');
  expect(reply.get('thing_id')).toBe('t4_abc');
  expect(reply.get('text')).toBe('Hello from Mae');
  const read = new URLSearchParams(requests[1]?.body ?? '');
  expect(read.get('id')).toBe('t4_abc');
});
