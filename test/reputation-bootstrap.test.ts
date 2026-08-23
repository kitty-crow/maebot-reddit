import { describe, expect, test } from 'bun:test';
import type { RedditRelationshipUser } from '../src/reddit/decode.ts';
import type {
  RedditComment,
  RedditFlairAssignment,
  RedditFlairTemplate,
  RedditModerator,
  RedditPost,
} from '../src/reddit/types.ts';
import { planReputationBootstrap } from '../src/reputation/bootstrap.ts';
import { CATGIRLCOIN_REPUTATION_FLAIRS } from '../src/reputation/liveFlairs.ts';
import {
  MODERATOR_POINTS,
  PAWSOME_FLAIR_TEXT,
  PAWSOME_POINTS,
  REPUTATION_FLOOR,
  UNCIVIL_CEILING,
} from '../src/reputation/policy.ts';

const live = CATGIRLCOIN_REPUTATION_FLAIRS;

const flair = (
  id: string,
  text: string,
  cssClass: string | null = null,
  modOnly = false,
): RedditFlairTemplate => ({
  id,
  text,
  cssClass,
  textColour: 'dark',
  backgroundColour: null,
  modOnly,
  textEditable: false,
  allowableContent: 'all',
  maxEmojis: 1,
});

const userFlairs = (): readonly RedditFlairTemplate[] => [
  flair(live.user.mae.id, live.user.mae.text, live.user.mae.cssClass),
  flair(live.user.lisa.id, live.user.lisa.text, live.user.lisa.cssClass),
  flair(live.user.kita.id, live.user.kita.text, live.user.kita.cssClass),
  flair(live.user.aoi.id, live.user.aoi.text, live.user.aoi.cssClass),
  flair(live.user.hana.id, live.user.hana.text, live.user.hana.cssClass),
  flair(live.user.rin.id, live.user.rin.text, live.user.rin.cssClass),
  flair(live.user.celeste.id, live.user.celeste.text, live.user.celeste.cssClass),
  flair(live.user.pawsomeContributor.id, live.user.pawsomeContributor.text, live.user.pawsomeContributor.cssClass, true),
  flair(live.user.warned.id, live.user.warned.text, live.user.warned.cssClass, true),
  flair(live.user.uncivil.id, live.user.uncivil.text, live.user.uncivil.cssClass, true),
  flair(live.user.scam.id, live.user.scam.text, live.user.scam.cssClass, true),
  flair('302a5e30-d43c-11eb-903c-0e0bd4f00481', 'Moderator:kitty-business:', 'm', true),
  flair('legacy', 'Legacy Special'),
];

const postFlairs = (): readonly RedditFlairTemplate[] => [
  flair(live.post.minorAnnouncement.id, live.post.minorAnnouncement.text),
  flair(live.post.announcement.id, live.post.announcement.text),
  flair('ad0c483a-3b72-11ec-9b51-22febc678528', 'Question :hana:'),
];

const assignment = (username: string, templateId: string, text: string, cssClass: string | null = null): RedditFlairAssignment => ({
  username,
  templateId,
  text,
  cssClass,
});

const moderator = (name: string): RedditModerator => ({ name, id: `id-${name}`, permissions: ['all'] });
const banned = (username: string): RedditRelationshipUser => ({ username, note: null, date: 1 });

const post = (id: string, author: string | null): RedditPost => ({
  id,
  fullname: `t3_${id}`,
  subreddit: 'catgirlcoin',
  title: `post ${id}`,
  author,
  permalink: `/r/catgirlcoin/comments/${id}/post/`,
  createdUtc: 1,
  selfText: '',
  url: '',
  flairTemplateId: null,
  flairText: null,
  stickied: false,
  locked: false,
  over18: false,
  crosspostParent: null,
  score: 0,
  mediaUrls: [],
});

const comment = (id: string, author: string | null): RedditComment => ({
  id,
  fullname: `t1_${id}`,
  subreddit: 'catgirlcoin',
  submissionFullname: 't3_parent',
  author,
  body: `comment ${id}`,
  permalink: `/r/catgirlcoin/comments/parent/post/${id}/`,
  createdUtc: 1,
  distinguished: null,
  stickied: false,
  removedByCategory: null,
  score: 0,
  mediaUrls: [],
});

describe('Reddit reputation bootstrap planner', () => {
  test('seeds exact live tiers, Pawsome, moderation states, permanent bans, tier-nine moderators and first contributors', () => {
    const plan = planReputationBootstrap({
      subreddit: 'catgirlcoin',
      at: 123,
      userFlairs: userFlairs(),
      postFlairs: postFlairs(),
      assignments: [
        assignment('Alice', live.user.mae.id, ':mae:', 'h'),
        assignment('Bob', live.user.kita.id, ':kita:', 'h'),
        assignment('Carol', live.user.celeste.id, ':celeste:', 'h'),
        assignment('Poppy', live.user.pawsomeContributor.id, PAWSOME_FLAIR_TEXT, 'h'),
        assignment('Wendy', live.user.warned.id, ' ', 'w'),
        assignment('Uma', live.user.uncivil.id, ' ', 'u'),
        assignment('Sam', live.user.scam.id, 'SCAM', 's'),
        assignment('Barry', live.user.mae.id, ':mae:', 'h'),
        assignment('Mona', '302a5e30-d43c-11eb-903c-0e0bd4f00481', 'Moderator:kitty-business:', 'm'),
        assignment('Lenny', 'legacy', 'Legacy Special'),
      ],
      moderators: [moderator('Mona')],
      bannedUsers: [banned('Barry'), banned('Sam')],
      posts: [post('p1', 'FreshUser'), post('p2', 'Alice')],
      comments: [comment('c1', 'FreshUser'), comment('c2', null)],
    });

    const users = new Map(plan.bootstrap.users.map(value => [value.username, value]));
    expect(users.get('Alice')?.points).toBe(1);
    expect(users.get('Bob')?.points).toBe(10);
    expect(users.get('Carol')?.points).toBe(1000);
    expect(users.get('Poppy')?.points).toBe(PAWSOME_POINTS);
    expect(users.get('Poppy')?.tier).toBe(5);
    expect(users.get('Wendy')?.points).toBe(-1);
    expect(users.get('Wendy')?.status).toBe('warned');
    expect(users.get('Uma')?.points).toBe(UNCIVIL_CEILING);
    expect(users.get('Uma')?.status).toBe('uncivil');
    expect(users.get('Barry')?.points).toBe(REPUTATION_FLOOR);
    expect(users.get('Barry')?.status).toBe('banned');
    expect(users.get('Sam')?.points).toBe(REPUTATION_FLOOR);
    expect(users.get('Sam')?.status).toBe('scam');
    expect(users.get('Mona')?.points).toBe(MODERATOR_POINTS);
    expect(users.get('Mona')?.tier).toBe(9);
    expect(users.get('Mona')?.immutableModeratorFlair).toBe(true);
    expect(users.get('Mona')?.status).toBe('moderator');
    expect(users.get('Lenny')?.needsReview).toBe(true);
    expect(users.get('Lenny')?.status).toBe('unmapped');

    const fresh = users.get('FreshUser');
    expect(fresh?.points).toBe(1);
    expect(fresh?.tier).toBe(1);
    expect(fresh?.needsFlair).toBe(true);
    expect([':mae:', ':lisa:']).toContain(fresh?.desiredFlairText);
    if (fresh?.desiredFlairText === ':lisa:') expect(fresh.desiredFlairTemplateId).toBe(live.user.lisa.id);
    else expect(fresh?.desiredFlairTemplateId).toBe(live.user.mae.id);
    expect(plan.recentContributorsWithoutFlair).toBe(1);

    expect(plan.bootstrap.flairReferences.user.mae).toBe(live.user.mae.id);
    expect(plan.bootstrap.flairReferences.user.pawsomeContributor).toBe(live.user.pawsomeContributor.id);
    expect(plan.bootstrap.flairReferences.user.warned).toBe(live.user.warned.id);
    expect(plan.bootstrap.flairReferences.user.uncivil).toBe(live.user.uncivil.id);
    expect(plan.bootstrap.flairReferences.user.scam).toBe(live.user.scam.id);
    expect(plan.bootstrap.flairReferences.post.minorAnnouncement).toBe(live.post.minorAnnouncement.id);
    expect(plan.bootstrap.flairReferences.post.announcement).toBe(live.post.announcement.id);
  });

  test('uses a stable first-tier variant for the same subreddit and username', () => {
    const inventory = {
      subreddit: 'catgirlcoin',
      at: 123,
      userFlairs: userFlairs(),
      postFlairs: postFlairs(),
      assignments: [],
      moderators: [],
      bannedUsers: [],
      posts: [post('p1', 'StableUser')],
      comments: [],
    } as const;
    const first = planReputationBootstrap(inventory).bootstrap.users[0];
    const second = planReputationBootstrap(inventory).bootstrap.users[0];
    if (first === undefined || second === undefined) throw new Error('StableUser was not planned');
    expect(first.desiredFlairText).toBe(second.desiredFlairText);
    expect(first.desiredFlairTemplateId).toBe(second.desiredFlairTemplateId);
  });

  test('fails closed when a recorded canonical live flair is missing or changed', () => {
    expect(() => planReputationBootstrap({
      subreddit: 'catgirlcoin',
      at: 1,
      userFlairs: userFlairs().filter(value => value.id !== live.user.pawsomeContributor.id),
      postFlairs: postFlairs(),
      assignments: [],
      moderators: [],
      bannedUsers: [],
      posts: [],
      comments: [],
    })).toThrow(live.user.pawsomeContributor.id);

    expect(() => planReputationBootstrap({
      subreddit: 'catgirlcoin',
      at: 1,
      userFlairs: userFlairs().map(value => value.id === live.user.warned.id ? { ...value, cssClass: 'wrong' } : value),
      postFlairs: postFlairs(),
      assignments: [],
      moderators: [],
      bannedUsers: [],
      posts: [],
      comments: [],
    })).toThrow(live.user.warned.id);

    expect(() => planReputationBootstrap({
      subreddit: 'catgirlcoin',
      at: 1,
      userFlairs: userFlairs(),
      postFlairs: postFlairs().filter(value => value.id !== live.post.announcement.id),
      assignments: [],
      moderators: [],
      bannedUsers: [],
      posts: [],
      comments: [],
    })).toThrow(live.post.announcement.id);
  });

  test('fails closed for duplicate user assignment', () => {
    expect(() => planReputationBootstrap({
      subreddit: 'catgirlcoin',
      at: 1,
      userFlairs: userFlairs(),
      postFlairs: postFlairs(),
      assignments: [assignment('Alice', live.user.mae.id, ':mae:'), assignment('alice', live.user.mae.id, ':mae:')],
      moderators: [],
      bannedUsers: [],
      posts: [],
      comments: [],
    })).toThrow('Duplicate flair assignment');
  });
});
