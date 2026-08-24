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

describe('Reddit user flair selection verification', () => {
  test('reads the selected template UUID and rendered text for a named user', async () => {
    const fetcher: RedditMutationFetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/access_token')) return token();

      expect(url.pathname).toBe('/r/catgirlcoin/api/flairselector');
      expect(init?.method).toBe('POST');
      const form = new URLSearchParams(String(init?.body ?? ''));
      expect(form.get('name')).toBe('TypoUser');

      return new Response(JSON.stringify({
        current: {
          flair_template_id: 'canonical-pawsome',
          flair_text: 'Pawsome contributor :catgirl-moon:',
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const client = new RedditMutationClient(auth, { fetcher, sleep: async () => undefined });
    expect(await client.userFlairSelection('catgirlcoin', 'TypoUser')).toEqual({
      templateId: 'canonical-pawsome',
      text: 'Pawsome contributor :catgirl-moon:',
    });
  });
});
