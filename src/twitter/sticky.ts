import type { RedditPost } from '../reddit/types.ts';

export type StickySlot = 1 | 2;

export type StickyPlan =
  | { readonly action: 'already_sticky'; readonly slot: StickySlot }
  | { readonly action: 'use_empty_slot'; readonly slot: StickySlot }
  | { readonly action: 'blocked'; readonly occupied: readonly { readonly slot: StickySlot; readonly postId: string }[] };

const samePost = (post: RedditPost | null, desiredPostId: string): boolean =>
  post !== null && (post.id === desiredPostId || post.fullname === desiredPostId || post.fullname === `t3_${desiredPostId}`);

export const planSticky = (
  stickies: readonly [RedditPost | null, RedditPost | null],
  desiredPostId: string,
): StickyPlan => {
  if (desiredPostId.trim().length === 0) throw new Error('Desired sticky post ID is required');
  if (samePost(stickies[0], desiredPostId)) return { action: 'already_sticky', slot: 1 };
  if (samePost(stickies[1], desiredPostId)) return { action: 'already_sticky', slot: 2 };
  if (stickies[0] === null) return { action: 'use_empty_slot', slot: 1 };
  if (stickies[1] === null) return { action: 'use_empty_slot', slot: 2 };
  return {
    action: 'blocked',
    occupied: [
      { slot: 1, postId: stickies[0].id },
      { slot: 2, postId: stickies[1].id },
    ],
  };
};
