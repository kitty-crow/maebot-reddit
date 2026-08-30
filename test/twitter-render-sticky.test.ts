import { describe, expect, test } from 'bun:test';
import type { Tweet } from '../vendor/maebot-twitter/src/index.ts';
import type { RedditPost } from '../src/reddit/types.ts';
import { planSticky } from '../src/twitter/sticky.ts';
import { redditTweetTitle, renderLegacyFallback, renderTweetForReddit } from '../src/twitter/render.ts';

const baseTweet = (): Tweet => ({
  id: '1234567890',
  url: 'https://twitter.com/NyaOnEarth/status/1234567890',
  text: 'Nya update with all the context.',
  at: 100,
  author: { name: 'Nya', handle: 'NyaOnEarth', avatar: 'https://example.test/avatar.png' },
  photos: ['https://example.test/photo.jpg'],
  videos: ['https://example.test/video.mp4'],
  quote: {
    id: '9876543210',
    url: 'https://twitter.com/example/status/9876543210',
    text: 'Quoted context',
    author: { name: 'Example', handle: 'example', avatar: null },
  },
  poll: {
    choices: [
      { label: 'Yes', count: 7, percentage: 70 },
      { label: 'No', count: 3, percentage: 30 },
    ],
    total: 10,
    endsAt: '2026-08-18T12:00:00Z',
  },
});

const post = (id: string): RedditPost => ({
  id,
  fullname: `t3_${id}`,
  subreddit: 'nyaonearth',
  title: `Post ${id}`,
  author: 'this_is_the_mae',
  permalink: `/r/nyaonearth/comments/${id}/post/`,
  createdUtc: 1,
  selfText: '',
  url: '',
  flairTemplateId: null,
  flairText: null,
  stickied: true,
  locked: false,
  over18: false,
  crosspostParent: null,
  score: 0,
  mediaUrls: [],
});

describe('Twitter Reddit rendering', () => {
  test('preserves tweet text, source link, quote and poll context without leaking Twitter media URLs', () => {
    const rendered = renderTweetForReddit(baseTweet());
    expect(rendered.title).toBe('Nya update with all the context.');
    expect(rendered.body).toContain('Nya update with all the context.');
    expect(rendered.body).not.toContain('https://example.test/photo.jpg');
    expect(rendered.body).not.toContain('https://example.test/video.mp4');
    expect(rendered.body).toContain('Quoted tweet by @example');
    expect(rendered.body).toContain('Quoted context');
    expect(rendered.body).toContain('Quoted tweet: https://twitter.com/example/status/9876543210');
    expect(rendered.body).toContain('Yes: 7 votes (70%)');
    expect(rendered.body).toContain('No: 3 votes (30%)');
    expect(rendered.body).toContain('10 total votes');
    expect(rendered.body).toContain('Ends: 2026-08-18T12:00:00Z');
    expect(rendered.body).toContain('Original tweet: https://twitter.com/NyaOnEarth/status/1234567890');
  });

  test('uses a deterministic fallback title and clips long titles by Unicode character', () => {
    const empty = { ...baseTweet(), text: '   ' };
    expect(redditTweetTitle(empty)).toBe('Update from @NyaOnEarth');
    const long = { ...baseTweet(), text: '🐈'.repeat(40) };
    const clipped = redditTweetTitle(long, 20);
    expect([...clipped]).toHaveLength(20);
    expect(clipped.endsWith('…')).toBe(true);
  });

  test('fallback legacy rendering does not expose redundant primary Reddit metadata', () => {
    const rendered = renderLegacyFallback(baseTweet(), 'https://reddit.com/r/nyaonearth/comments/primary');
    expect(rendered.body).toContain('Original tweet: https://twitter.com/NyaOnEarth/status/1234567890');
    expect(rendered.body).not.toContain('Primary Reddit post:');
  });
});

describe('sticky safety planner', () => {
  test('recognises a post that is already sticky', () => {
    expect(planSticky([post('one'), null], 'one')).toEqual({ action: 'already_sticky', slot: 1 });
    expect(planSticky([null, post('two')], 't3_two')).toEqual({ action: 'already_sticky', slot: 2 });
  });

  test('uses an empty slot without disturbing an existing unrelated sticky', () => {
    expect(planSticky([post('existing'), null], 'desired')).toEqual({ action: 'use_empty_slot', slot: 2 });
  });

  test('blocks when both sticky slots are occupied rather than selecting an eviction victim', () => {
    expect(planSticky([post('one'), post('two')], 'desired')).toEqual({
      action: 'blocked',
      occupied: [
        { slot: 1, postId: 'one' },
        { slot: 2, postId: 'two' },
      ],
    });
  });
});
