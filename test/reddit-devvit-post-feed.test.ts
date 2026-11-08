import { describe, expect, test } from 'bun:test';
import { DevvitExternalClient, type DevvitExternalFetch } from '../src/reddit/devvitExternal.ts';
import { parseDevvitPostFeed } from '../src/reddit/devvitPostFeed.ts';
import { posts as decodeLegacyPosts } from '../src/reddit/decode.ts';
import type { RedditPost } from '../src/reddit/types.ts';

const request = { subreddit: 'catgirlcoin', feed: 'new', limit: 25 } as const;
const post: RedditPost = {
  id: 'abc123',
  fullname: 't3_abc123',
  subreddit: 'catgirlcoin',
  title: 'Example',
  author: 'Nya',
  permalink: '/r/catgirlcoin/comments/abc123/example/',
  createdUtc: 1794124800,
  selfText: 'Example body',
  url: 'https://i.redd.it/abc123.webp',
  flairTemplateId: 'flair-id',
  flairText: 'Announcement',
  stickied: true,
  locked: false,
  over18: false,
  crosspostParent: null,
  score: 12,
  mediaUrls: ['https://i.redd.it/abc123.webp'],
};
const feed = (posts: readonly RedditPost[]): string =>
  JSON.stringify({ protocol: 1, subreddit: 'catgirlcoin', feed: 'new', posts });

describe('Devvit post-feed read parity', () => {
  test('matches the current OAuth post decoder for representative post data', () => {
    const legacy = decodeLegacyPosts({
      data: {
        after: null,
        children: [{
          kind: 't3',
          data: {
            id: post.id, name: post.fullname, subreddit: post.subreddit,
            title: post.title, author: post.author, permalink: post.permalink,
            created_utc: post.createdUtc, selftext: post.selfText, url: post.url,
            link_flair_template_id: post.flairTemplateId, link_flair_text: post.flairText,
            stickied: post.stickied, locked: post.locked, over_18: post.over18,
            score: post.score,
          },
        }],
      },
    }).items;
    expect(parseDevvitPostFeed(feed([post]), request)).toEqual(legacy);
  });
  test('validates feed, community and post identifiers, including duplicate detection', () => {
    expect(() => parseDevvitPostFeed(feed([{ ...post, subreddit: 'nyaonearth' }]), request)).toThrow();
    expect(() => parseDevvitPostFeed(feed([post, post]), request)).toThrow();
    expect(() => parseDevvitPostFeed(feed([{ ...post, fullname: 't3_other' }]), request)).toThrow();
    expect(() => parseDevvitPostFeed(feed([post]).replace('"new"', '"hot"'), request)).toThrow();
  });
  test('refuses missing fields, unexpectedly large responses and excessive results', () => {
    expect(() => parseDevvitPostFeed(
      JSON.stringify({ protocol: 1, subreddit: 'catgirlcoin', feed: 'new', posts: [{ id: 'x' }] }), request,
    )).toThrow();
    expect(() => parseDevvitPostFeed(' '.repeat(524_289), request)).toThrow();
    expect(() => parseDevvitPostFeed(feed(Array.from({ length: 26 }, () => post)), request)).toThrow();
  });
  test('sends only the allowed request with a managed token', async () => {
    const fetcher: DevvitExternalFetch = async (url, init) => {
      expect(url).toBe('https://this-is-the-mae-abc123-external.devvit.net/external/mae/read/posts');
      expect(new Headers(init.headers).get('authorization')).toBe('bearer devvit_at_test_secret_key');
      expect(JSON.parse(String(init.body))).toEqual(request);
      return new Response(feed([post]));
    };
    const client = new DevvitExternalClient({
      baseUrl: 'https://this-is-the-mae-abc123-external.devvit.net',
      managedToken: 'devvit_at_test_secret_key',
    }, fetcher);
    expect(await client.readPosts(request)).toEqual([post]);
  });
  test('does not leak response bodies or tokens on failed HTTP requests', async () => {
    const fetcher: DevvitExternalFetch = async () => new Response('sensitive response', { status: 403 });
    const client = new DevvitExternalClient({
      baseUrl: 'https://this-is-the-mae-abc123-external.devvit.net',
      managedToken: 'devvit_at_test_secret_key',
    }, fetcher);
    await expect(client.readPosts(request)).rejects.toThrow('HTTP 403');
  });
});
