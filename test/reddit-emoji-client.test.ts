import { describe, expect, test } from 'bun:test';
import { RedditReadClient, type RedditFetch } from '../src/reddit/client.ts';
import type { RedditEmoji } from '../src/reddit/emoji.ts';
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

const emoji: RedditEmoji = {
  name: 'catgirl-moon',
  url: 'https://emoji.redditmedia.com/source_t5_catgirlcoin/catgirl-moon.png',
  modFlairOnly: false,
  postFlairAllowed: true,
  userFlairAllowed: true,
};

describe('Reddit custom emoji client', () => {
  test('reads the subreddit-owned emoji inventory through the canonical read client', async () => {
    const fetcher: RedditFetch = async input => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/access_token')) return token();
      expect(url.pathname).toBe('/api/v1/catgirlcoin/emojis/all');
      return new Response(JSON.stringify({
        snoomojis: {},
        t5_catgirlcoin: {
          'catgirl-moon': {
            url: emoji.url,
            mod_flair_only: false,
            post_flair_allowed: true,
            user_flair_allowed: true,
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const client = new RedditReadClient(auth, { fetcher, sleep: async () => undefined });
    expect(await client.emojis('catgirlcoin')).toEqual([emoji]);
  });

  test('uploads through Reddit lease -> S3 multipart -> emoji registration and can repair permissions separately', async () => {
    const redditPaths: string[] = [];
    const fetcher: RedditMutationFetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/access_token')) return token();
      redditPaths.push(url.pathname);

      if (url.pathname.endsWith('/emoji_asset_upload_s3.json')) {
        const form = new URLSearchParams(String(init?.body ?? ''));
        expect(form.get('filepath')).toBe('catgirl-moon.png');
        expect(form.get('mimetype')).toBe('image/png');
        return new Response(JSON.stringify({
          s3UploadLease: {
            action: '//reddit-emoji-upload.s3.amazonaws.com',
            fields: [
              { name: 'key', value: 'nyaonearth/source-copy' },
              { name: 'policy', value: 'signed-policy' },
            ],
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      const form = new URLSearchParams(String(init?.body ?? ''));
      expect(form.get('name')).toBe('catgirl-moon');
      expect(form.get('mod_flair_only')).toBe('false');
      expect(form.get('post_flair_allowed')).toBe('true');
      expect(form.get('user_flair_allowed')).toBe('true');
      if (url.pathname.endsWith('/emoji.json')) expect(form.get('s3_key')).toBe('nyaonearth/source-copy');
      else expect(url.pathname).toBe('/api/v1/nyaonearth/emoji_permissions');
      return new Response(null, { status: 200 });
    };

    let uploaded = false;
    const uploadFetcher: RedditMutationFetch = async (input, init) => {
      expect(String(input)).toBe('https://reddit-emoji-upload.s3.amazonaws.com/');
      expect(init?.method).toBe('POST');
      if (!(init?.body instanceof FormData)) throw new Error('Expected multipart S3 form');
      expect(init.body.get('key')).toBe('nyaonearth/source-copy');
      expect(init.body.get('policy')).toBe('signed-policy');
      const file = init.body.get('file');
      expect(file instanceof Blob).toBe(true);
      if (!(file instanceof Blob)) throw new Error('Expected emoji Blob');
      expect(file.type).toBe('image/png');
      expect(file.size).toBe(3);
      uploaded = true;
      return new Response(null, { status: 204 });
    };

    const client = new RedditMutationClient(auth, {
      fetcher,
      uploadFetcher,
      sleep: async () => undefined,
      maxAttempts: 1,
    });
    await client.uploadEmoji('nyaonearth', emoji, {
      bytes: new Uint8Array([1, 2, 3]).buffer,
      filename: 'catgirl-moon.png',
      mimeType: 'image/png',
    });
    await client.updateEmojiPermissions('nyaonearth', emoji);

    expect(uploaded).toBe(true);
    expect(redditPaths).toEqual([
      '/api/v1/nyaonearth/emoji_asset_upload_s3.json',
      '/api/v1/nyaonearth/emoji.json',
      '/api/v1/nyaonearth/emoji_permissions',
    ]);
  });
});
