import { describe, expect, test } from 'vitest';
import { parseCommunityRequest, projectModerator, projectRule } from '../src/server/communityRead.ts';

describe('read-only community metadata', () => {
  test('keeps the original moderator permissions without inferring authority', () => {
    expect(projectModerator({
      username: 'Mae', id: 't2_abc', moderatorInfo: { modPermissions: ['posts', 'flair'] },
    })).toEqual({ name: 'Mae', id: 't2_abc', permissions: ['posts', 'flair'] });
  });
  test('preserves nullable-free native community rules without inventing site rules', () => {
    expect(projectRule({
      shortName: 'Stay civil', description: 'Be nice', violationReason: 'Uncivil',
      kind: 'all', priority: 1,
    })).toEqual({
      shortName: 'Stay civil', description: 'Be nice', violationReason: 'Uncivil',
      kind: 'all', priority: 1,
    });
  });
  test('limits metadata requests to Mae communities and explicit operations', () => {
    expect(parseCommunityRequest({ subreddit: 'catgirlcoin', kind: 'moderators' }))
      .toEqual({ subreddit: 'catgirlcoin', kind: 'moderators' });
    expect(() => parseCommunityRequest({ subreddit: 'other', kind: 'moderators' })).toThrow();
    expect(() => parseCommunityRequest({ subreddit: 'nyaonearth', kind: 'mutate' })).toThrow();
  });
});
