import type { RedditPost } from './types.ts';

export type StickyReader = {
  hotPosts(subreddit: string, limit?: number): Promise<readonly RedditPost[]>;
};

export type StickySlots = readonly [
  RedditPost | null,
  RedditPost | null,
  RedditPost | null,
  RedditPost | null,
];

export const readStickySlots = async (
  reader: StickyReader,
  subreddit: string,
): Promise<StickySlots> => {
  const stickies = (await reader.hotPosts(subreddit, 100)).filter(post => post.stickied);
  return [
    stickies[0] ?? null,
    stickies[1] ?? null,
    stickies[2] ?? null,
    stickies[3] ?? null,
  ];
};
