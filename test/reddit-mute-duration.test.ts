import { describe, expect, test } from 'bun:test';
import type { RedditAuthCfg } from '../src/env.ts';
import { RedditMutationClient, type RedditMutationFetch } from '../src/reddit/mutate.ts';

const auth: RedditAuthCfg = {
  clientId: 'client',
  clientSecret: 'secret',
  username: 'mae',
  password: 'password',
  userAgent: 'mae-test',
};

describe('Reddit reputation mute durations', () => {
  test('uses seven days for uncivil and thirty days for banned/scam enforcement', async () => {
    const forms: URLSearchParams[] = [];
    const fetcher: RedditMutationFetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/access_token')) {
        return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 });
      }
      if (url.pathname.endsWith('/api/friend')) {
        if (!(init?.body instanceof URLSearchParams)) throw new Error('expected form body');
        forms.push(new URLSearchParams(init.body));
        return new Response(JSON.stringify({ json: { errors: [] } }), { status: 200 });
      }
      return new Response('', { status: 404 });
    };

    const client = new RedditMutationClient(auth, { fetcher, maxAttempts: 1 });
    await client.muteUser('catgirlcoin', 'uncivil-user', 'Mae uncivil reputation state');
    await client.muteUser('catgirlcoin', 'banned-user', 'Mae permanent reputation enforcement');
    await client.muteUser('catgirlcoin', 'manual-user', 'Mae canonical moderation state');

    expect(forms.map(form => form.get('duration'))).toEqual(['7', '30', '28']);
    expect(forms.every(form => form.get('type') === 'muted')).toBe(true);
  });
});
