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

describe('Reddit sticky discovery', () => {
  test('derives the first two sticky slots from hot-listing order', async () => {
    const first = post('one', true);
    const ordinary = post('ordinary', false);
    const second = post('two', true);
    const reader: StickyReader = {
      hotPosts: async () => [first, ordinary, second],
    };
    expect(await readStickySlots(reader, 'catgirlcoin')).toEqual([first, second]);
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
    expect(await readStickySlots(reader, 'catgirlcoin')).toEqual([null, null]);
    expect(calls).toBe(1);
  });

  test('ignores additional stickied listing entries beyond Reddit migration slots 1 and 2', async () => {
    const first = post('one', true);
    const second = post('two', true);
    const third = post('three', true);
    const reader: StickyReader = { hotPosts: async () => [first, second, third] };
    expect(await readStickySlots(reader, 'catgirlcoin')).toEqual([first, second]);
  });
});
