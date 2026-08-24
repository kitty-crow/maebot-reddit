import { describe, expect, test } from 'bun:test';
import { communityFlairRestores } from '../src/reputation/communityProjection.ts';
import type { RedditFlairAssignment } from '../src/reddit/types.ts';

const catalogue = {
  schema: 2,
  sourceSubreddit: 'catgirlcoin',
  targetSubreddit: 'nyaonearth',
  userTemplates: {
    source: [{ id: 'source-tier', text: ':hana:', textEditable: false }],
    target: [{ id: 'target-tier', text: ':hana:', textEditable: false }],
    mapping: [{ sourceTemplateId: 'source-tier', targetTemplateId: 'target-tier' }],
  },
};

const reputation = {
  users: {
    alice: {
      username: 'Alice',
      status: 'ordinary',
      desiredFlairTemplateId: 'source-tier',
      desiredFlairText: ':hana:',
      immutableModeratorFlair: false,
      needsReview: false,
    },
  },
};

const assignment = (
  templateId: string | null,
  text: string | null,
): RedditFlairAssignment => ({
  username: 'Alice',
  templateId,
  text,
  cssClass: null,
});

describe('community flair projection with Reddit legacy assignments', () => {
  test('does not rewrite correct projected text when Reddit omits the target UUID', () => {
    expect(communityFlairRestores(catalogue, reputation, 'nyaonearth', [assignment(null, ':hana:')]))
      .toEqual([]);
  });

  test('restores wrong projected text when Reddit omits the target UUID', () => {
    expect(communityFlairRestores(catalogue, reputation, 'nyaonearth', [assignment(null, ':kita:')]))
      .toEqual([{ username: 'Alice', templateId: 'target-tier', customText: null }]);
  });

  test('restores an explicitly wrong target UUID even when projected text matches', () => {
    expect(communityFlairRestores(catalogue, reputation, 'nyaonearth', [assignment('wrong-id', ':hana:')]))
      .toEqual([{ username: 'Alice', templateId: 'target-tier', customText: null }]);
  });
});
