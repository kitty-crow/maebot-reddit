import { describe, expect, test } from 'bun:test';
import { RedditError } from '../src/reddit/error.ts';
import { readStickySlots, type StickyReader } from '../src/reddit/stickySlots.ts';
import type { RedditPost } from '../src/reddit/types.ts';

const post = (id: string): RedditPost => ({
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
  stickied: true,
  locked: false,
  over18: false,
  crosspostParent: null,
});

describe('Reddit sticky slot compatibility', () => {
  test('does not probe slot 2 when slot 1 is empty', async () => {
    const calls: number[] = [];
    const reader: StickyReader = {
      sticky: async (_subreddit, slot) => {
        calls.push(slot);
        return null;
      },
    };
    expect(await readStickySlots(reader, 'catgirlcoin')).toEqual([null, null]);
    expect(calls).toEqual([1]);
  });

  test('treats the observed HTTP 400 on slot 2 as an empty second slot', async () => {
    const first = post('one');
    const reader: StickyReader = {
      sticky: async (_subreddit, slot) => {
        if (slot === 1) return first;
        throw new RedditError('GET /r/catgirlcoin/sticky failed', 'bad_request', 400);
      },
    };
    expect(await readStickySlots(reader, 'catgirlcoin')).toEqual([first, null]);
  });

  test('does not suppress non-400 failures from slot 2', async () => {
    const reader: StickyReader = {
      sticky: async (_subreddit, slot) => {
        if (slot === 1) return post('one');
        throw new RedditError('forbidden', 'forbidden', 403);
      },
    };
    expect(readStickySlots(reader, 'catgirlcoin')).rejects.toBeInstanceOf(RedditError);
  });
});
