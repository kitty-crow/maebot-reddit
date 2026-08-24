import { describe, expect, test } from 'bun:test';
import {
  RETIRED_MODERATOR_TRACKING_USERS,
  isRetiredModeratorTrackingUser,
  reputationUsersRequiringReview,
} from '../src/reputation/trackingRepair.ts';

const unresolved = (username: string) => ({
  username,
  points: 0,
  tier: 0,
  status: 'unmapped',
  currentFlairTemplateId: null,
  currentFlairText: 'Retired moderator flair',
  currentFlairCssClass: 'm',
  desiredFlairTemplateId: null,
  desiredFlairText: 'Retired moderator flair',
  immutableModeratorFlair: false,
  needsFlair: false,
  needsReview: true,
  source: 'unmapped-flair',
  seededAt: 123,
});

describe('retired moderator legacy tracking', () => {
  test('ignores only the three explicitly retired moderator records', () => {
    expect(RETIRED_MODERATOR_TRACKING_USERS).toEqual([
      'Flair_Helper',
      'nonfungibleneko',
      'PsychologicalPrize71',
    ]);

    for (const username of RETIRED_MODERATOR_TRACKING_USERS) {
      expect(isRetiredModeratorTrackingUser(username)).toBe(true);
      expect(isRetiredModeratorTrackingUser(username.toUpperCase())).toBe(true);
    }
    expect(isRetiredModeratorTrackingUser('StillNeedsReview')).toBe(false);

    const users = Object.fromEntries([
      ...RETIRED_MODERATOR_TRACKING_USERS.map(username => [username.toLowerCase(), unresolved(username)]),
      ['stillneedsreview', unresolved('StillNeedsReview')],
    ]);

    expect(reputationUsersRequiringReview({
      schema: 1,
      subreddit: 'catgirlcoin',
      bootstrappedAt: 123,
      users,
    })).toEqual(['StillNeedsReview']);
  });
});
