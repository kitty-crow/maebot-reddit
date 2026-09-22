import { describe, expect, test } from 'bun:test';
import { directMessages } from '../src/dm/decode.ts';
import { modmailConversation, modmailConversations } from '../src/modmail/decode.ts';
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
        subscribersCount: 42,
        isNsfw: false,
        authorFlairSettings: {
          isEnabled: true,
          isSelfAssignabled: false,
        },
        postFlairSettings: {
          isEnabled: true,
        },
      };
    },
    getModerators() {
      return listing([
        {
          username: 'this_is_the_mae',
          id: 't2_app',
          moderatorInfo: { modPermissions: ['all'] },
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
    modMail: {
      async getConversations() {
        return {
          conversations: {
            abcdef: {
              id: 'abcdef',
              subredditName: 'catgirlcoin',
              subject: 'Help',
              participant: {
                id: 't2_member',
                name: 'Member',
                isMod: false,
                isAdmin: false,
                isParticipant: true,
                isHidden: false,
                isDeleted: false,
              },
              conversationType: 'sr_user',
              state: 'InProgress',
              isInternal: false,
              isAuto: false,
              lastUpdated: new Date('2026-01-06T00:00:00.000Z'),
              messages: {
                m1: {
                  id: 'm1',
                  conversationId: 'abcdef',
                  author: {
                    id: 't2_member',
                    name: 'Member',
                    isMod: false,
                    isAdmin: false,
                    isParticipant: true,
                    isHidden: false,
                    isDeleted: false,
                  },
                  bodyMarkdown: 'Hello',
                  date: new Date('2026-01-06T00:00:00.000Z'),
                  isInternal: false,
                  participatingAs: 'user',
                },
              },
            },
          },
        };
      },
      async getConversation() {
        return {
          conversation: {
            id: 'abcdef',
            subredditName: 'catgirlcoin',
            subject: 'Help',
            participant: {
              id: 't2_member',
              name: 'Member',
              isMod: false,
              isAdmin: false,
              isParticipant: true,
              isHidden: false,
              isDeleted: false,
            },
            conversationType: 'sr_user',
            state: 'inprogress',
            isInternal: false,
            isAuto: false,
            lastUpdated: new Date('2026-01-06T00:00:00.000Z'),
            messages: {
              m1: {
                id: 'm1',
                conversationId: 'abcdef',
                author: {
                  id: 't2_member',
                  name: 'Member',
                  isMod: false,
                  isAdmin: false,
                  isParticipant: true,
                  isHidden: false,
                  isDeleted: false,
                },
                bodyMarkdown: 'Hello',
                date: new Date('2026-01-06T00:00:00.000Z'),
                isInternal: false,
                participatingAs: 'user',
              },
            },
          },
        };
      },
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
        distinguishedBy: null,
        stickied: false,
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
      submissionType: null,
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

  test('rules use Devvit while incomplete flair-template reads stay on OAuth', async () => {
    expect(await handleLegacyRead({
      method: 'GET',
      path: '/r/catgirlcoin/api/user_flair_v2',
    }, roots)).toEqual({ supported: false });
    expect(await handleLegacyRead({
      method: 'GET',
      path: '/r/catgirlcoin/api/link_flair_v2',
    }, roots)).toEqual({ supported: false });

    const rules = supported(await handleLegacyRead({
      method: 'GET',
      path: '/r/catgirlcoin/about/rules',
    }, roots));

    expect(decode.rules(rules).rules).toEqual([{
      shortName: 'Be nice',
      description: 'No abuse',
      violationReason: 'Abuse',
      kind: 'all',
      priority: 0,
    }]);
  });

  test('existing post and score decoders consume post-only adapter output', async () => {
    const posts = supported(await handleLegacyRead({
      method: 'GET',
      path: '/r/catgirlcoin/new',
      query: { limit: '25' },
    }, roots));
    const info = supported(await handleLegacyRead({
      method: 'GET',
      path: '/api/info',
      query: { id: 't3_post' },
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
    ]);
  });

  test('keeps comment score batches on OAuth because Devvit Comment omits archived state', async () => {
    expect(await handleLegacyRead({
      method: 'GET',
      path: '/api/info',
      query: { id: 't3_post,t1_comment' },
    }, roots)).toEqual({ supported: false });
  });

  test('existing Modmail decoders consume adapter output unchanged', async () => {
    const pageBody = supported(await handleLegacyRead({
      method: 'GET',
      path: '/api/mod/conversations',
      query: { entity: 'catgirlcoin', limit: '100', sort: 'recent', state: 'all' },
    }, roots));
    const singleBody = supported(await handleLegacyRead({
      method: 'GET',
      path: '/api/mod/conversations/abcdef',
      query: { markRead: 'false' },
    }, roots));

    const page = modmailConversations(pageBody);
    expect(page.conversations).toHaveLength(1);
    expect(page.conversations[0]).toMatchObject({
      id: 'abcdef',
      subreddit: 'catgirlcoin',
      subject: 'Help',
      state: 'new',
    });
    expect(page.conversations[0]?.messages[0]).toMatchObject({
      id: 'm1',
      bodyMarkdown: 'Hello',
      createdAt: 1767657600,
    });

    expect(modmailConversation(singleBody)).toMatchObject({
      id: 'abcdef',
      subreddit: 'catgirlcoin',
      subject: 'Help',
    });
  });

  test('passes exact relationship filters and listing cursors into Devvit', async () => {
    const seen: unknown[] = [];
    const filteredRoots = {
      ...roots,
      reddit: {
        ...roots.reddit,
        getBannedUsers(options: unknown) {
          seen.push(['banned', options]);
          return listing([{ id: 't2_bad', username: 'BadUser', note: null }]);
        },
        getNewPosts(options: unknown) {
          seen.push(['new', options]);
          return listing(Array.from({ length: 2 }, (_, index) => ({
            ...post(),
            id: `t3_post${index + 1}`,
          })));
        },
      },
    };

    await handleLegacyRead({
      method: 'GET',
      path: '/r/catgirlcoin/about/banned',
      query: { limit: '1', user: 'BadUser', after: 't2_prev' },
    }, filteredRoots);

    await handleLegacyRead({
      method: 'GET',
      path: '/r/catgirlcoin/new',
      query: { limit: '2', after: 't3_prev' },
    }, filteredRoots);

    expect(seen).toEqual([
      ['banned', {
        subredditName: 'catgirlcoin',
        limit: 1,
        pageSize: 1,
        after: 't2_prev',
        username: 'BadUser',
      }],
      ['new', {
        subredditName: 'catgirlcoin',
        limit: 2,
        pageSize: 2,
        after: 't3_prev',
      }],
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
