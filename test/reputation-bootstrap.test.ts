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

const flair = (id: string, text: string, cssClass: string | null = null): RedditFlairTemplate => ({
  id,
  text,
  cssClass,
  textColour: 'dark',
  backgroundColour: null,
  modOnly: false,
  textEditable: false,
  allowableContent: 'all',
  maxEmojis: 1,
});

const userFlairs = (): readonly RedditFlairTemplate[] => [
  flair('mae', ':mae:'),
  flair('lisa', ':lisa:'),
  flair('kita', ':kita:'),
  flair('aoi', ':aoi:'),
  flair('hana', ':hana:'),
  flair('rin', ':rin:'),
  flair('celeste', ':celeste:'),
  flair('warned', 'Warned', 'w'),
  flair('uncivil', 'Uncivil', 'u'),
  flair('scam', 'SCAM', 's'),
  flair('moderator', 'Moderator'),
  flair('legacy', 'Legacy Special'),
];

const postFlairs = (): readonly RedditFlairTemplate[] => [
  flair('minor', 'Minor Announcement :lisa:'),
  flair('announcement', 'Announcement :catgirl-moon:'),
  flair('question', 'Question'),
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
});

describe('Reddit reputation bootstrap planner', () => {
  test('seeds tiers, moderation states, immutable tier-five moderators and first contributors', () => {
    const plan = planReputationBootstrap({
      subreddit: 'catgirlcoin',
      at: 123,
      userFlairs: userFlairs(),
      postFlairs: postFlairs(),
      assignments: [
        assignment('Alice', 'mae', ':mae:'),
        assignment('Bob', 'kita', ':kita:'),
        assignment('Carol', 'celeste', ':celeste:'),
        assignment('Wendy', 'warned', 'Warned', 'w'),
        assignment('Uma', 'uncivil', 'Uncivil', 'u'),
        assignment('Sam', 'scam', 'SCAM', 's'),
        assignment('Barry', 'mae', ':mae:'),
        assignment('Mona', 'moderator', 'Moderator'),
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
    expect(users.get('Wendy')?.points).toBe(-1);
    expect(users.get('Wendy')?.status).toBe('warned');
    expect(users.get('Uma')?.points).toBe(-2);
    expect(users.get('Barry')?.points).toBe(-3);
    expect(users.get('Barry')?.status).toBe('banned');
    expect(users.get('Sam')?.points).toBe(-4);
    expect(users.get('Sam')?.status).toBe('scam');
    expect(users.get('Mona')?.tier).toBe(5);
    expect(users.get('Mona')?.immutableModeratorFlair).toBe(true);
    expect(users.get('Mona')?.status).toBe('moderator');
    expect(users.get('Lenny')?.needsReview).toBe(true);
    expect(users.get('Lenny')?.status).toBe('unmapped');

    const fresh = users.get('FreshUser');
    expect(fresh?.points).toBe(1);
    expect(fresh?.tier).toBe(1);
    expect(fresh?.needsFlair).toBe(true);
    expect([':mae:', ':lisa:']).toContain(fresh?.desiredFlairText);
    if (fresh?.desiredFlairText === ':lisa:') expect(fresh.desiredFlairTemplateId).toBe('lisa');
    else expect(fresh?.desiredFlairTemplateId).toBe('mae');
    expect(plan.recentContributorsWithoutFlair).toBe(1);

    expect(plan.bootstrap.flairReferences.user.mae).toBe('mae');
    expect(plan.bootstrap.flairReferences.user.warned).toBe('warned');
    expect(plan.bootstrap.flairReferences.user.uncivil).toBe('uncivil');
    expect(plan.bootstrap.flairReferences.user.scam).toBe('scam');
    expect(plan.bootstrap.flairReferences.post.minorAnnouncement).toBe('minor');
    expect(plan.bootstrap.flairReferences.post.announcement).toBe('announcement');
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

  test('fails closed for missing required tier flair or duplicate user assignment', () => {
    expect(() => planReputationBootstrap({
      subreddit: 'catgirlcoin',
      at: 1,
      userFlairs: userFlairs().filter(value => value.text !== ':rin:'),
      postFlairs: postFlairs(),
      assignments: [],
      moderators: [],
      bannedUsers: [],
      posts: [],
      comments: [],
    })).toThrow(':rin:');

    expect(() => planReputationBootstrap({
      subreddit: 'catgirlcoin',
      at: 1,
      userFlairs: userFlairs(),
      postFlairs: postFlairs(),
      assignments: [assignment('Alice', 'mae', ':mae:'), assignment('alice', 'mae', ':mae:')],
      moderators: [],
      bannedUsers: [],
      posts: [],
      comments: [],
    })).toThrow('Duplicate flair assignment');
  });

  test('leaves optional status and announcement references unresolved rather than guessing', () => {
    const plan = planReputationBootstrap({
      subreddit: 'catgirlcoin',
      at: 1,
      userFlairs: userFlairs().filter(value => !['Warned', 'Uncivil', 'SCAM'].includes(value.text)),
      postFlairs: postFlairs().filter(value => !value.text.includes('Announcement')),
      assignments: [],
      moderators: [],
      bannedUsers: [],
      posts: [],
      comments: [],
    });
    expect(plan.bootstrap.flairReferences.user.warned).toBeNull();
    expect(plan.bootstrap.flairReferences.user.uncivil).toBeNull();
    expect(plan.bootstrap.flairReferences.user.scam).toBeNull();
    expect(plan.bootstrap.flairReferences.post.minorAnnouncement).toBeNull();
    expect(plan.bootstrap.flairReferences.post.announcement).toBeNull();
  });
});
