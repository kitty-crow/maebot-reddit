import { RedditError } from './error.ts';
import type { RedditPost } from './types.ts';

export type StickyReader = {
  sticky(subreddit: string, slot: 1 | 2): Promise<RedditPost | null>;
};

export const readStickySlots = async (
  reader: StickyReader,
  subreddit: string,
): Promise<readonly [RedditPost | null, RedditPost | null]> => {
  const first = await reader.sticky(subreddit, 1);
  if (first === null) return [null, null];

  try {
    return [first, await reader.sticky(subreddit, 2)];
  } catch (error) {
    // Reddit documents an empty sticky as 404, but the live OAuth endpoint can
    // return HTTP 400 when slot 1 exists and slot 2 is empty. Restrict this
    // compatibility case to the second slot only; slot-1 errors still fail
    // closed so we never assume all sticky slots are free on an ambiguous API
    // failure.
    if (error instanceof RedditError && error.kind === 'bad_request' && error.status === 400) {
      return [first, null];
    }
    throw error;
  }
};
