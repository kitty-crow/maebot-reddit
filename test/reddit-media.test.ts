import { expect, test } from 'bun:test';
import type { RedditAuthCfg } from '../src/env.ts';
import { RedditMediaClient, type RedditMediaFetch } from '../src/reddit/media.ts';

const cfg: RedditAuthCfg = {
  clientId: 'client',
  clientSecret: 'secret',
  username: 'mae',
  password: 'password',
  userAgent: 'mae-test',
};

const token = (value = 'token'): Response => new Response(JSON.stringify({ access_token: value, expires_in: 3600 }), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

const lease = (assetId: string | null = null, key = 'test/media.png'): Response => new Response(JSON.stringify({
  args: {
    action: '//reddit-uploaded-media.s3-accelerate.amazonaws.com',
    fields: [
      { name: 'key', value: key },
      { name: 'acl', value: 'public-read' },
    ],
  },
  ...(assetId === null ? {} : { asset: { asset_id: assetId } }),
}), { status: 200, headers: { 'content-type': 'application/json' } });

const created = (id = 'abc123'): Response => new Response(JSON.stringify({
  json: {
    errors: [],
    data: {
      id,
      name: `t3_${id}`,
      url: `https://reddit.com/comments/${id}`,
    },
  },
}), { status: 200, headers: { 'content-type': 'application/json' } });

test('Reddit media client obtains a lease and uploads bytes to the returned HTTPS target', async () => {
  const calls: { readonly url: string; readonly init: RequestInit | undefined }[] = [];
  const fetcher: RedditMediaFetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/api/v1/access_token')) return token();
    if (url.includes('/api/media/asset.json')) {
      expect(init?.headers).toMatchObject({ authorization: 'Bearer token' });
      const body = init?.body;
      expect(body).toBeInstanceOf(URLSearchParams);
      expect((body as URLSearchParams).get('filepath')).toBe('media.png');
      expect((body as URLSearchParams).get('mimetype')).toBe('image/png');
      return lease();
    }
    expect(url).toBe('https://reddit-uploaded-media.s3-accelerate.amazonaws.com');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init?.body as FormData;
    expect(form.get('key')).toBe('test/media.png');
    const file = form.get('file');
    expect(file).toBeInstanceOf(Blob);
    expect((file as Blob).size).toBe(3);
    expect((file as Blob).type).toBe('image/png');
    return new Response('', { status: 204 });
  };

  const client = new RedditMediaClient(cfg, fetcher);
  expect(await client.uploadMedia('media.png', 'image/png', new Uint8Array([1, 2, 3])))
    .toBe('https://reddit-uploaded-media.s3-accelerate.amazonaws.com/test/media.png');
  expect(calls).toHaveLength(3);
});

test('Reddit media client submits uploaded video as a native Reddit video post', async () => {
  const fetcher: RedditMediaFetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/api/v1/access_token')) return token();
    if (url.includes('/api/media/asset.json')) return lease(null, 'test/video.mp4');
    if (url === 'https://reddit-uploaded-media.s3-accelerate.amazonaws.com') return new Response('', { status: 204 });
    expect(url).toBe('https://oauth.reddit.com/api/submit');
    expect(init?.body).toBeInstanceOf(URLSearchParams);
    const form = init?.body as URLSearchParams;
    expect(form.get('kind')).toBe('video');
    expect(form.get('url')).toBe('https://reddit-uploaded-media.s3-accelerate.amazonaws.com/test/video.mp4');
    expect(form.get('text')).toBe('GM! What are you up to today?');
    expect(form.get('flair_id')).toBe('flair');
    return created('video1');
  };

  const client = new RedditMediaClient(cfg, fetcher);
  const post = await client.submitMedia(
    'nyaonearth',
    'GM! What are you up to today?',
    'GM! What are you up to today?',
    'flair',
    'video.mp4',
    'video/mp4',
    new Uint8Array([1, 2, 3]),
  );
  expect(post.id).toBe('video1');
});

test('Reddit media client submits multiple uploaded images as a native Reddit gallery', async () => {
  let leases = 0;
  const fetcher: RedditMediaFetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/api/v1/access_token')) return token();
    if (url.includes('/api/media/asset.json')) {
      leases += 1;
      return lease(`asset-${leases}`, `test/image-${leases}.png`);
    }
    if (url === 'https://reddit-uploaded-media.s3-accelerate.amazonaws.com') return new Response('', { status: 204 });
    expect(url).toBe('https://oauth.reddit.com/api/submit_gallery_post.json');
    expect(typeof init?.body).toBe('string');
    const payload = JSON.parse(String(init?.body)) as {
      readonly items: readonly { readonly media_id: string }[];
      readonly sr: string;
      readonly title: string;
    };
    expect(payload.items).toEqual([{ media_id: 'asset-1' }, { media_id: 'asset-2' }]);
    expect(payload.sr).toBe('nyaonearth');
    expect(payload.title).toBe('Gallery tweet');
    return created('gallery1');
  };

  const client = new RedditMediaClient(cfg, fetcher);
  const post = await client.submitGallery('nyaonearth', 'Gallery tweet', 'flair', [
    { name: 'one.png', mimeType: 'image/png', bytes: new Uint8Array([1]) },
    { name: 'two.png', mimeType: 'image/png', bytes: new Uint8Array([2]) },
  ]);
  expect(post.id).toBe('gallery1');
});

test('Reddit media client refreshes OAuth exactly once after a lease 401', async () => {
  let tokenCalls = 0;
  let leaseCalls = 0;
  const fetcher: RedditMediaFetch = async input => {
    const url = String(input);
    if (url.endsWith('/api/v1/access_token')) {
      tokenCalls += 1;
      return token(`token-${tokenCalls}`);
    }
    if (url.includes('/api/media/asset.json')) {
      leaseCalls += 1;
      if (leaseCalls === 1) return new Response('', { status: 401 });
      return lease();
    }
    return new Response('', { status: 204 });
  };

  const client = new RedditMediaClient(cfg, fetcher);
  await client.uploadMedia('media.png', 'image/png', new Uint8Array([1]));
  expect(tokenCalls).toBe(2);
  expect(leaseCalls).toBe(2);
});

test('Reddit media client rejects empty and oversized media before touching OAuth', async () => {
  let called = false;
  const client = new RedditMediaClient(cfg, async () => {
    called = true;
    return new Response('', { status: 500 });
  });
  await expect(client.uploadMedia('empty.png', 'image/png', new Uint8Array())).rejects.toThrow('between 1 byte and 20 MB');
  await expect(client.uploadMedia('huge.png', 'image/png', new Uint8Array(20 * 1024 * 1024 + 1))).rejects.toThrow('between 1 byte and 20 MB');
  expect(called).toBe(false);
});
