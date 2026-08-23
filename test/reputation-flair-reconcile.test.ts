import { expect, test } from 'bun:test';
import { applyBootstrapFlairs, type ReputationFlairWriter } from '../src/reputation/flairReconcile.ts';
import type { ReputationBootstrap, ReputationUser } from '../src/reputation/store.ts';
import type { RedditFlairTemplate } from '../src/reddit/types.ts';

const template = (id: string, text: string): RedditFlairTemplate => ({
  id,
  text,
  cssClass: null,
  textColour: 'dark',
  backgroundColour: null,
  modOnly: false,
  textEditable: false,
  allowableContent: 'all',
  maxEmojis: 1,
});

const user = (overrides: Partial<ReputationUser>): ReputationUser => ({
  username: 'FreshUser',
  points: 1,
  tier: 1,
  status: 'ordinary',
  currentFlairTemplateId: null,
  currentFlairText: null,
  currentFlairCssClass: null,
  desiredFlairTemplateId: 'mae',
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
  userFlairTemplates: [
    template('mae', ':mae:'),
    template('lisa', ':lisa:'),
    template('kita', ':kita:'),
    template('aoi', ':aoi:'),
    template('hana', ':hana:'),
    template('rin', ':rin:'),
    template('celeste', ':celeste:'),
    template('pawsome', 'Pawsome Contributor'),
  ],
  postFlairTemplates: [],
  flairReferences: {
    user: {
      mae: 'mae',
      lisa: 'lisa',
      kita: 'kita',
      aoi: 'aoi',
      hana: 'hana',
      rin: 'rin',
      celeste: 'celeste',
      pawsomeContributor: 'pawsome',
      warned: null,
      uncivil: null,
      scam: null,
    },
    post: {
      minorAnnouncement: null,
      announcement: null,
    },
  },
  users,
  coverage: {
    flairAssignments: 0,
    moderators: 0,
    bannedUsers: 0,
    recentPostsScanned: 1,
    recentCommentsScanned: 0,
    recentContributorsWithoutFlair: 1,
    note: 'test',
  },
});

test('bootstrap applies every discovered missing tier flair and marks persisted state reconciled', async () => {
  const calls: string[] = [];
  const writer: ReputationFlairWriter = {
    setUserFlairTemplate: async (subreddit, username, templateId, customText) => {
      calls.push(`${subreddit}:${username}:${templateId}:${customText ?? '-'}`);
    },
  };

  const result = await applyBootstrapFlairs(bootstrap([
    user({}),
    user({
      username: 'AlreadyFlared',
      currentFlairTemplateId: 'kita',
      currentFlairText: ':kita:',
      desiredFlairTemplateId: 'kita',
      desiredFlairText: ':kita:',
      points: 10,
      tier: 2,
      needsFlair: false,
      source: 'tier-flair',
    }),
  ]), writer);

  expect(result.applied).toBe(1);
  expect(calls).toEqual(['catgirlcoin:FreshUser:mae:-']);
  const fresh = result.bootstrap.users.find(value => value.username === 'FreshUser');
  expect(fresh?.needsFlair).toBe(false);
  expect(fresh?.currentFlairTemplateId).toBe('mae');
  expect(fresh?.currentFlairText).toBe(':mae:');
});

test('bootstrap refuses to reconcile a moderator through tier flair machinery', async () => {
  const writer: ReputationFlairWriter = {
    setUserFlairTemplate: async () => undefined,
  };
  await expect(applyBootstrapFlairs(bootstrap([
    user({
      username: 'Mod',
      status: 'moderator',
      tier: 9,
      points: 999_999_999,
      immutableModeratorFlair: true,
    }),
  ]), writer)).rejects.toThrow('Moderator');
});
