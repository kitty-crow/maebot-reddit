import { describe, expect, test } from 'vitest';
import { parseFeedRequest, projectPost, type PostSource } from '../src/server/postFeed.ts';

const post: PostSource = {
  id: 't3_abc123',
  subredditName: 'catgirlcoin',
  title: 'Example',
  authorName: 'Nya',
  permalink: '/r/catgirlcoin/comments/abc123/example/',
  createdAt: new Date('2026-11-08T08:00:00.000Z'),
  body: 'Example body',
  url: 'https://i.redd.it/abc123.webp',
  flair: { templateId: 'flair-id', text: 'Announcement' },
  stickied: true,
  locked: false,
  nsfw: false,
  crosspostParentId: undefined,
  score: 12,
  gallery: [{ url: 'https://i.redd.it/abc123.webp' }],
  thumbnail: undefined,
  secureMedia: undefined,
};

describe('Devvit post-feed projection', () => {
  test('retains Mae RedditPost identity, timestamps, flair and media', () => {
    expect(projectPost(post)).toEqual({
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
    });
  });
  test('retains null semantics and crosspost parent', () => {
    const result = projectPost({ ...post, authorName: '[deleted]', body: undefined,
      flair: undefined, crosspostParentId: 't3_parent' });
    expect(result.author).toBeNull();
    expect(result.selfText).toBe('');
    expect(result.flairTemplateId).toBeNull();
    expect(result.crosspostParent).toBe('t3_parent');
  });
  test('maps SDK flair properties explicitly set to undefined to null', () => {
    const result = projectPost({
      ...post,
      flair: { templateId: undefined, text: undefined },
    });
    expect(result.flairTemplateId).toBeNull();
    expect(result.flairText).toBeNull();
  });
  test('allows only recognised community feeds with bounded integer limits', () => {
    expect(parseFeedRequest({ subreddit: 'nyaonearth', feed: 'hot', limit: 25 }))
      .toEqual({ subreddit: 'nyaonearth', feed: 'hot', limit: 25 });
    for (const input of [{ subreddit: 'other', feed: 'new', limit: 1 },
      { subreddit: 'catgirlcoin', feed: 'other', limit: 1 },
      { subreddit: 'catgirlcoin', feed: 'new', limit: 101 },
      { subreddit: 'catgirlcoin', feed: 'new', limit: 0.5 }, null]) {
      expect(() => parseFeedRequest(input)).toThrow();
    }
  });
  test('caps media links and deduplicates the native direct URL', () => {
    const gallery = Array.from({ length: 20 }, (_, index) => ({
      url: 'https://i.redd.it/' + index + '.png',
    }));
    const result = projectPost({ ...post, gallery });
    expect(result.mediaUrls).toHaveLength(12);
    expect(result.mediaUrls[0]).toBe(post.url);
  });
});
