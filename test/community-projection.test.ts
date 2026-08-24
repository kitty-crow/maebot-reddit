import { describe, expect, test } from 'bun:test';
import { communityFlairRestores } from '../src/reputation/communityProjection.ts';

const catalogue = {
  schema: 2,
  sourceSubreddit: 'catgirlcoin',
  targetSubreddit: 'nyaonearth',
  userTemplates: {
    source: [
      { id: 'source-tier', text: ':hana:', textEditable: false },
      { id: 'source-warned', text: ' ', textEditable: false },
    ],
    target: [
      { id: 'target-tier', text: ':hana:', textEditable: false },
      { id: 'target-warned', text: ' ', textEditable: false },
    ],
    mapping: [
      { sourceTemplateId: 'source-tier', targetTemplateId: 'target-tier' },
      { sourceTemplateId: 'source-warned', targetTemplateId: 'target-warned' },
    ],
  },
};

describe('canonical cross-community flair projection', () => {
  test('maps canonical source UUIDs to subreddit-local target UUIDs without duplicating reputation', () => {
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
        warned: {
          username: 'WarnedUser',
          status: 'warned',
          desiredFlairTemplateId: 'source-warned',
          desiredFlairText: ' ',
          immutableModeratorFlair: false,
          needsReview: false,
        },
        moderator: {
          username: 'HumanMod',
          status: 'moderator',
          desiredFlairTemplateId: 'source-tier',
          desiredFlairText: ':hana:',
          immutableModeratorFlair: true,
          needsReview: false,
        },
      },
    };

    expect(communityFlairRestores(catalogue, reputation, 'nyaonearth', [])).toEqual([
      { username: 'Alice', templateId: 'target-tier', customText: null },
      { username: 'WarnedUser', templateId: 'target-warned', customText: null },
    ]);
  });

  test('does nothing when target subreddit already reflects canonical projection', () => {
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
    const assignments = [{
      username: 'Alice',
      templateId: 'target-tier',
      text: ':hana:',
      cssClass: null,
    }];
    expect(communityFlairRestores(catalogue, reputation, 'nyaonearth', assignments)).toEqual([]);
  });

  test('fails closed when a canonical source flair lacks a target mapping', () => {
    const reputation = {
      users: {
        alice: {
          username: 'Alice',
          status: 'ordinary',
          desiredFlairTemplateId: 'missing-source-template',
          desiredFlairText: ':hana:',
          immutableModeratorFlair: false,
          needsReview: false,
        },
      },
    };
    expect(() => communityFlairRestores(catalogue, reputation, 'nyaonearth', []))
      .toThrow('No r/nyaonearth flair mapping');
  });
});
