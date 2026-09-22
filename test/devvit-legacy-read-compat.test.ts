import { describe, expect, test } from 'bun:test';
import { directMessages } from '../src/dm/decode.ts';
import * as decode from '../src/reddit/decode.ts';
import { thingScores } from '../src/reddit/scoreDecode.ts';
import {
  handleLegacyRead,
  type LegacyCompatResponse,
} from '../devvit/src/server/legacyCompat.ts';

const supported = (value: LegacyCompatResponse) => {
  if (!value.supported) throw new Error('expected adapter support');
  return value.body;
};

const listing = <T>(values: readonly T[]) => ({
  async all(): Promise<readonly T[]> {
    return values;
  },
});

const roots = {
  reddit: {
    async getAppUser() {
      return {
        id: 't2_app',
        username: 'this_is_the_mae',
        createdAt: new Date('2025-01-02T03:04:05.000Z'),
        linkKarma: 10,
        commentKarma: 20,
      };
    },
    async getSubredditInfoByName(name: string) {
      return {
        id: 't5_abc',
        name,
        title: 'Catgirl Coin',
        subscribers: 42,
        nsfw: false,
        type: 'public',
        authorFlairSettings: {
          enabled: true,
          usersCanAssign: false,
        },
        postFlairSettings: {
          enabled: true,
        },
      };
    },
    getModerators() {
      return listing([
        {
          username: 'this_is_the_mae',
          id: 't2_app',
          permissions: ['all'],
        },
      ]);
    },
    getBannedUsers() {
      return listing([
        {
          username: 'BadUser',
          note: 'reason',
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
        },
      ]);
    },
    getMutedUsers() {
      return listing([
        {
          username: 'MutedUser',
          note: 'quiet',
          date: new Date('2026-01-03T00:00:00.000Z'),
        },
      ]);
    },
    async getUserFlairTemplates() {
      return [{
        id: 'user-flair',
        text: 'Pawsome',
        cssClass: 'pawsome',
        textColor: 'dark',
        backgroundColor: '#ffffff',
        modOnly: false,
        allowUserEdits: false,
        allowableContent: 'all',
        maxEmojis: 2,
      }];
    },
    async getPostFlairTemplates() {
      return [{
        id: 'post-flair',
        text: 'Announcement',
        cssClass: 'announcement',
        textColor: 'light',
        backgroundColor: '#000000',
        modOnly: true,
        allowUserEdits: false,
        allowableContent: 'text',
        maxEmojis: 1,
      }];
    },
    async getRules() {
      return [{
        shortName: 'Be nice',
        description: 'No abuse',
        violationReason: 'Abuse',
        kind: 'all',
        priority: 0,
      }];
    },
    getHotPosts() {
      return listing([post()]);
    },
    getNewPosts() {
      return listing([post()]);
    },
    async getPostById() {
      return post();
    },
    async getCommentById() {
      return {
        id: 't1_comment',
        subredditName: 'catgirlcoin',
        postId: 't3_post',
        parentId: 't3_post',
        postTitle: 'Hello',
        postAuthorName: 'Poster',
        postPermalink: '/r/catgirlcoin/comments/post/hello/',
        postFlairText: 'Announcement',
        authorName: 'Commenter',
        body: 'hi',
        permalink: '/r/catgirlcoin/comments/post/hello/comment/',
        createdAt: new Date('2026-01-05T00:00:00.000Z'),
        distinguished: null,
        stickied: false,
        removedByCategory: null,
        score: 7,
        archived: false,
      };
    },
  },
  media: {},
};

const post = () => ({
  id: 't3_post',
  subredditName: 'catgirlcoin',
  title: 'Hello',
  authorName: 'Poster',
  permalink: '/r/catgirlcoin/comments/post/hello/',
  createdAt: new Date('2026-01-04T00:00:00.000Z'),
  body: 'body',
  url: 'https://reddit.com/r/catgirlcoin/comments/post/hello/',
  flair: {
    templateId: 'post-flair',
    text: 'Announcement',
  },
  stickied: true,
  locked: false,
  nsfw: false,
  crosspostParentId: null,
  score: 9,
  archived: false,
});

describe('Devvit legacy Reddit read compatibility', () => {
  test('existing account decoder consumes the adapter identity unchanged', async () => {
    const body = supported(await handleLegacyRead({
      method: 'GET',
      path: '/api/v1/me',
    }, roots));

    expect(decode.account(body)).toEqual({
      id: 'app',
      name: 'this_is_the_mae',
      createdUtc: 1735787045,
      linkKarma: 10,
      commentKarma: 20,
    });
  });

  test('existing subreddit decoder consumes the adapter response unchanged', async () => {
    const body = supported(await handleLegacyRead({
      method: 'GET',
      path: '/r/catgirlcoin/about',
    }, roots));

    expect(decode.subreddit(body)).toEqual({
      id: 'abc',
      name: 'catgirlcoin',
      title: 'Catgirl Coin',
      subscribers: 42,
      userIsModerator: true,
      userFlairEnabled: true,
      userFlairSelfAssign: false,
      linkFlairEnabled: true,
      over18: false,
      submissionType: 'public',
    });
  });

  test('existing moderator and relationship decoders consume adapter listings', async () => {
    const mods = supported(await handleLegacyRead({
      method: 'GET',
      path: '/r/catgirlcoin/about/moderators',
      query: { limit: '100' },
    }, roots));
    const banned = supported(await handleLegacyRead({
      method: 'GET',
      path: '/r/catgirlcoin/about/banned',
    }, roots));
    const muted = supported(await handleLegacyRead({
      method: 'GET',
      path: '/r/catgirlcoin/about/muted',
    }, roots));

    expect(decode.moderators(mods).items).toEqual([
      { name: 'this_is_the_mae', id: 't2_app', permissions: ['all'] },
    ]);
    expect(decode.relationshipUsers(banned).items[0]?.username).toBe('BadUser');
    expect(decode.relationshipUsers(muted).items[0]?.username).toBe('MutedUser');
  });

  test('existing flair and rule decoders consume adapter output', async () => {
    const userFlairs = supported(await handleLegacyRead({
      method: 'GET',
      path: '/r/catgirlcoin/api/user_flair_v2',
    }, roots));
    const postFlairs = supported(await handleLegacyRead({
      method: 'GET',
      path: '/r/catgirlcoin/api/link_flair_v2',
    }, roots));
    const rules = supported(await handleLegacyRead({
      method: 'GET',
      path: '/r/catgirlcoin/about/rules',
    }, roots));

    expect(decode.flairTemplates(userFlairs)[0]?.id).toBe('user-flair');
    expect(decode.flairTemplates(postFlairs)[0]?.id).toBe('post-flair');
    expect(decode.rules(rules).rules).toEqual([{
      shortName: 'Be nice',
      description: 'No abuse',
      violationReason: 'Abuse',
      kind: 'all',
      priority: 0,
    }]);
  });

  test('existing post and score decoders consume adapter output', async () => {
    const posts = supported(await handleLegacyRead({
      method: 'GET',
      path: '/r/catgirlcoin/new',
      query: { limit: '25' },
    }, roots));
    const info = supported(await handleLegacyRead({
      method: 'GET',
      path: '/api/info',
      query: { id: 't3_post,t1_comment' },
    }, roots));

    expect(decode.posts(posts).items[0]).toMatchObject({
      id: 'post',
      fullname: 't3_post',
      subreddit: 'catgirlcoin',
      title: 'Hello',
      score: 9,
    });
    expect(thingScores(info)).toEqual([
      { fullname: 't3_post', score: 9, archived: false },
      { fullname: 't1_comment', score: 7, archived: false },
    ]);
  });

  test('unsupported capabilities stay unsupported rather than being emulated', async () => {
    expect(await handleLegacyRead({
      method: 'GET',
      path: '/r/catgirlcoin/comments',
    }, roots)).toEqual({ supported: false });

    expect(await handleLegacyRead({
      method: 'GET',
      path: '/message/inbox',
    }, roots)).toEqual({ supported: false });
  });

  test('does not accidentally produce a private-message shape from unrelated data', () => {
    expect(() => directMessages({
      kind: 'Listing',
      data: { after: null, children: [] },
    })).not.toThrow();
  });
});
