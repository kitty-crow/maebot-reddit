import { expect, test } from 'bun:test';
import { applyBootstrapFlairs, plannedBootstrapFlairMutations } from '../src/reputation/reconcile.ts';
import type { ReputationBootstrap, ReputationUser } from '../src/reputation/store.ts';

const user = (overrides: Partial<ReputationUser> = {}): ReputationUser => ({
  username: 'FreshUser',
  points: 1,
  tier: 1,
  status: 'ordinary',
  currentFlairTemplateId: null,
  currentFlairText: null,
  currentFlairCssClass: null,
  desiredFlairTemplateId: 'mae-id',
  desiredFlairText: ':mae:',
  immutableModeratorFlair: false,
  needsFlair: true,
  needsReview: false,
  source: 'recent-unflaired-contributor',
  seededAt: 1,
  ...overrides,
});

const bootstrap = (users: readonly ReputationUser[]): ReputationBootstrap => ({
  subreddit: 'catgirlcoin',
  at: 1,
  userFlairTemplates: [],
  postFlairTemplates: [],
  flairReferences: {
    user: {
      mae: 'mae-id',
      lisa: 'lisa-id',
      kita: 'kita-id',
      aoi: 'aoi-id',
      hana: 'hana-id',
      rin: 'rin-id',
      celeste: 'celeste-id',
      pawsomeContributor: 'pawsome-id',
      warned: null,
      uncivil: null,
      scam: null,
    },
    post: { minorAnnouncement: null, announcement: null },
  },
  users,
  coverage: {
    flairAssignments: 0,
    moderators: 0,
    bannedUsers: 0,
    recentPostsScanned: 0,
    recentCommentsScanned: 0,
    recentContributorsWithoutFlair: users.filter(value => value.needsFlair).length,
    note: 'test',
  },
});

test('bootstrap flair reconciliation assigns every discovered ordinary user needing a flair', async () => {
  const state = bootstrap([
    user(),
    user({ username: 'LisaUser', desiredFlairTemplateId: 'lisa-id', desiredFlairText: ':lisa:' }),
    user({ username: 'Existing', currentFlairTemplateId: 'mae-id', currentFlairText: ':mae:', needsFlair: false }),
  ]);

  const calls: string[] = [];
  const applied = await applyBootstrapFlairs('catgirlcoin', state, {
    async setUserFlairTemplate(subreddit, username, templateId, customText) {
      calls.push(`${subreddit}:${username}:${templateId}:${customText ?? 'null'}`);
    },
  });

  expect(applied).toBe(2);
  expect(calls).toEqual([
    'catgirlcoin:FreshUser:mae-id:null',
    'catgirlcoin:LisaUser:lisa-id:null',
  ]);
});

test('bootstrap flair reconciliation refuses moderator or malformed mutations', () => {
  expect(() => plannedBootstrapFlairMutations(bootstrap([
    user({ username: 'Mod', tier: 9, status: 'moderator', immutableModeratorFlair: true }),
  ]))).toThrow('moderator');

  expect(() => plannedBootstrapFlairMutations(bootstrap([
    user({ desiredFlairTemplateId: null }),
  ]))).toThrow('Missing desired flair');
});
