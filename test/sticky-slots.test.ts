import { describe, expect, test } from 'bun:test';
import { readStickySlots, type StickyReader } from '../src/reddit/stickySlots.ts';
import type { RedditPost } from '../src/reddit/types.ts';

const post = (id: string, stickied: boolean): RedditPost => ({
  id,
  fullname: `t3_${id}`,
  subreddit: 'catgirlcoin',
  title: `Post ${id}`,
  author: 'member',
  permalink: `/r/catgirlcoin/comments/${id}/post_${id}/`,
  createdUtc: 1,
  selfText: '',
  url: `https://www.reddit.com/r/catgirlcoin/comments/${id}/post_${id}/`,
  flairTemplateId: null,
  flairText: null,
  stickied,
  locked: false,
  over18: false,
  crosspostParent: null,
});

describe('Reddit highlight discovery', () => {
  test('derives the first four API-visible highlight slots from hot-listing order', async () => {
    const first = post('one', true);
    const ordinary = post('ordinary', false);
    const second = post('two', true);
    const third = post('three', true);
    const fourth = post('four', true);
    const reader: StickyReader = {
      hotPosts: async () => [first, ordinary, second, third, fourth],
    };
    expect(await readStickySlots(reader, 'catgirlcoin')).toEqual([first, second, third, fourth]);
  });

  test('returns empty slots without calling the unreliable sticky endpoint', async () => {
    let calls = 0;
    const reader: StickyReader = {
      hotPosts: async (_subreddit, limit) => {
        calls += 1;
        expect(limit).toBe(100);
        return [post('ordinary', false)];
      },
    };
    expect(await readStickySlots(reader, 'catgirlcoin')).toEqual([null, null, null, null]);
    expect(calls).toBe(1);
  });

  test('ignores listing entries beyond the four slots exposed by the OAuth sticky API', async () => {
    const first = post('one', true);
    const second = post('two', true);
    const third = post('three', true);
    const fourth = post('four', true);
    const fifth = post('five', true);
    const reader: StickyReader = { hotPosts: async () => [first, second, third, fourth, fifth] };
    expect(await readStickySlots(reader, 'catgirlcoin')).toEqual([first, second, third, fourth]);
  });
});
