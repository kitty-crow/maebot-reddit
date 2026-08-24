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

const lease = (): Response => new Response(JSON.stringify({
  args: {
    action: '//reddit-uploaded-media.s3-accelerate.amazonaws.com',
    fields: [
      { name: 'key', value: 'test/media.png' },
      { name: 'acl', value: 'public-read' },
    ],
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
