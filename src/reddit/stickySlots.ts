import type { RedditPost } from './types.ts';

export type StickyReader = {
  hotPosts(subreddit: string, limit?: number): Promise<readonly RedditPost[]>;
};

export const readStickySlots = async (
  reader: StickyReader,
  subreddit: string,
): Promise<readonly [RedditPost | null, RedditPost | null]> => {
  const stickies = (await reader.hotPosts(subreddit, 100)).filter(post => post.stickied);
  return [stickies[0] ?? null, stickies[1] ?? null];
};
