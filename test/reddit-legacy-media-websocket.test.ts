import { expect, test } from 'bun:test';
import {
  LegacyRedditMediaClient,
  type LegacyRedditMediaAuth,
  type LegacyRedditMediaFetch,
  type LegacyRedditMediaSocketFactory,
} from '../src/reddit/legacyMedia.ts';

const cfg: LegacyRedditMediaAuth = {
  clientId: 'client',
  clientSecret: 'secret',
  username: 'mae',
  password: 'password',
  userAgent: 'mae-test',
};

const token = (): Response => new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

const lease = (): Response => new Response(JSON.stringify({
  args: {
    action: '//reddit-uploaded-media.s3-accelerate.amazonaws.com',
    fields: [
      { name: 'key', value: 'test/video.mp4' },
      { name: 'acl', value: 'public-read' },
    ],
  },
}), { status: 200, headers: { 'content-type': 'application/json' } });

const asynchronousSubmit = (): Response => new Response(JSON.stringify({
  json: {
    errors: [],
    data: {
      user_submitted_page: 'https://www.reddit.com/user/mae/submitted/',
      websocket_url: 'wss://k8s-lb.wss.redditmedia.com/job-id?m=signature',
    },
  },
}), { status: 200, headers: { 'content-type': 'application/json' } });

test('Reddit media client resolves an asynchronous native video submission through its websocket redirect', async () => {
  const fetcher: LegacyRedditMediaFetch = async input => {
    const url = String(input);
    if (url.endsWith('/api/v1/access_token')) return token();
    if (url.includes('/api/media/asset.json')) return lease();
    if (url === 'https://reddit-uploaded-media.s3-accelerate.amazonaws.com') return new Response('', { status: 204 });
    expect(url).toBe('https://oauth.reddit.com/api/submit');
    return asynchronousSubmit();
  };

  let socketUrl = '';
  let closed = false;
  const socketFactory: LegacyRedditMediaSocketFactory = url => {
    socketUrl = url;
    return {
      listen(onMessage, onError, onClose): void {
        void onError;
        void onClose;
        queueMicrotask(() => onMessage(JSON.stringify({
          type: 'success',
          payload: {
            redirect: 'https://www.reddit.com/r/nyaonearth/comments/video2/gm_what_are_you_up_to_today/',
          },
        })));
      },
      close(): void {
        closed = true;
      },
    };
  };

  const client = new LegacyRedditMediaClient(cfg, fetcher, 10, socketFactory);
  const post = await client.submitMedia(
    'nyaonearth',
    'GM! What are you up to today?',
    'GM! What are you up to today?',
    'flair',
    'video.mp4',
    'video/mp4',
    new Uint8Array([1, 2, 3]),
    'https://pbs.twimg.com/profile_images/example/avatar.jpg',
  );

  expect(socketUrl).toBe('wss://k8s-lb.wss.redditmedia.com/job-id?m=signature');
  expect(post).toEqual({
    id: 'video2',
    fullname: 't3_video2',
    url: 'https://www.reddit.com/r/nyaonearth/comments/video2/gm_what_are_you_up_to_today/',
  });
  expect(closed).toBe(true);
});

test('Reddit media client rejects an untrusted asynchronous media websocket URL', async () => {
  const fetcher: LegacyRedditMediaFetch = async input => {
    const url = String(input);
    if (url.endsWith('/api/v1/access_token')) return token();
    if (url.includes('/api/media/asset.json')) return lease();
    if (url === 'https://reddit-uploaded-media.s3-accelerate.amazonaws.com') return new Response('', { status: 204 });
    return new Response(JSON.stringify({
      json: {
        errors: [],
        data: { websocket_url: 'wss://example.com/not-reddit' },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  let connected = false;
  const socketFactory: LegacyRedditMediaSocketFactory = () => {
    connected = true;
    throw new Error('must not connect');
  };
  const client = new LegacyRedditMediaClient(cfg, fetcher, 10, socketFactory);

  await expect(client.submitMedia(
    'nyaonearth',
    'Video',
    'Video body',
    'flair',
    'video.mp4',
    'video/mp4',
    new Uint8Array([1]),
    'https://pbs.twimg.com/profile_images/example/avatar.jpg',
  )).rejects.toThrow('websocket URL was not trusted');
  expect(connected).toBe(false);
});