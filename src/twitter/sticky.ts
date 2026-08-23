import type { RedditPost } from '../reddit/types.ts';
import type { StickySlots } from '../reddit/stickySlots.ts';

export type StickySlot = 1 | 2 | 3 | 4;

export type StickyPlan =
  | { readonly action: 'already_sticky'; readonly slot: StickySlot }
  | { readonly action: 'use_empty_slot'; readonly slot: StickySlot }
  | { readonly action: 'blocked'; readonly occupied: readonly { readonly slot: StickySlot; readonly postId: string }[] };

const samePost = (post: RedditPost | null, desiredPostId: string): boolean =>
  post !== null && (post.id === desiredPostId || post.fullname === desiredPostId || post.fullname === `t3_${desiredPostId}`);

export const planSticky = (
  stickies: StickySlots,
  desiredPostId: string,
): StickyPlan => {
  if (desiredPostId.trim().length === 0) throw new Error('Desired sticky post ID is required');

  for (let index = 0; index < stickies.length; index += 1) {
    const slot = (index + 1) as StickySlot;
    if (samePost(stickies[index] ?? null, desiredPostId)) return { action: 'already_sticky', slot };
  }

  for (let index = 0; index < stickies.length; index += 1) {
    const slot = (index + 1) as StickySlot;
    if ((stickies[index] ?? null) === null) return { action: 'use_empty_slot', slot };
  }

  return {
    action: 'blocked',
    occupied: stickies.map((post, index) => ({
      slot: (index + 1) as StickySlot,
      postId: post?.id ?? '',
    })),
  };
};
