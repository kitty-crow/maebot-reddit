import { describe, expect, test } from 'vitest';
import {
  handleLegacyRequest,
  type LegacyCompatRequest,
} from './legacyCompat.ts';
import type { AdapterRoots } from './controller.ts';

const request = async (
  roots: AdapterRoots,
  value: LegacyCompatRequest,
) => await handleLegacyRequest(value, roots);

const baseRoots = (): {
  roots: AdapterRoots;
  calls: string[];
  state: { readonly modmailReplies: string[] };
} => {
  const calls: string[] = [];
  const state = { modmailReplies: [] as string[] };

  class Model {
    public constructor(
      public readonly id: string,
      public readonly subredditName = 'catgirlcoin',
    ) {}

    public get title(): string { return 'Title'; }
    public get authorName(): string { return 'Mae'; }
    public get permalink(): string { return '/r/catgirlcoin/comments/abc/title/'; }
    public get createdAt(): Date { return new Date('2026-09-22T00:00:00Z'); }
    public get body(): string { return 'body'; }
    public get url(): string { return 'https://reddit.com/r/catgirlcoin/comments/abc'; }
    public get flair(): null { return null; }
    public get stickied(): boolean { return false; }
    public get locked(): boolean { return false; }
    public get nsfw(): boolean { return false; }
    public get crosspostParentId(): null { return null; }
    public get score(): number { return 7; }
    public async sticky(slot: 1 | 2): Promise<void> {
      calls.push(`sticky:${this.id}:${slot}`);
    }
  }

  const reddit = {
    async getAppUser(): Promise<object> {
      calls.push('getAppUser');
      return {
        id: 't2_mae',
        username: 'this_is_the_mae',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        linkKarma: 12,
        commentKarma: 34,
      };
    },
    async getSubredditInfoByName(name: string): Promise<object> {
      calls.push(`getSubredditInfoByName:${name}`);
      return {
        id: 't5_test',
        name,
        title: 'Test',
        subscribers: 42,
        nsfw: false,
        authorFlairSettings: { enabled: true, usersCanAssign: true },
        postFlairSettings: { enabled: true },
      };
    },
    getModerators(): object {
      return {
        async all(): Promise<readonly object[]> {
          return [{ username: 'this_is_the_mae', id: 't2_mae', permissions: ['all'] }];
        },
      };
    },
    getBannedUsers(): object {
      return { async all(): Promise<readonly object[]> { return []; } };
    },
    getMutedUsers(): object {
      return { async all(): Promise<readonly object[]> { return []; } };
    },
    async getUserFlairTemplates(): Promise<readonly object[]> { return []; },
    async getPostFlairTemplates(): Promise<readonly object[]> { return []; },
    async getRules(): Promise<readonly object[]> {
      calls.push('getRules');
      return [{
        shortName: 'Be nice',
        description: 'Be nice.',
        violationReason: 'Not nice',
        kind: 'all',
        priority: 0,
      }];
    },
    getHotPosts(): object {
      return { async all(): Promise<readonly Model[]> { return [new Model('t3_abc')]; } };
    },
    getNewPosts(): object {
      return { async all(): Promise<readonly Model[]> { return [new Model('t3_abc')]; } };
    },
    async getPostById(id: string): Promise<Model> { return new Model(id); },
    async getCommentById(id: string): Promise<object> {
      return {
        id,
        subredditName: 'catgirlcoin',
        postId: 't3_post',
        authorName: 'Member',
        body: 'comment',
        permalink: '/r/catgirlcoin/comments/post/title/id/',
        createdAt: new Date('2026-09-22T00:00:00Z'),
        score: 3,
      };
    },
    async submitPost(options: object): Promise<Model> {
      calls.push(`submitPost:${JSON.stringify(options)}`);
      return new Model('t3_created');
    },
    async crosspost(options: object): Promise<Model> {
      calls.push(`crosspost:${JSON.stringify(options)}`);
      return new Model('t3_cross');
    },
    async createUserFlairTemplate(): Promise<void> { calls.push('createUserFlairTemplate'); },
    async createPostFlairTemplate(): Promise<void> { calls.push('createPostFlairTemplate'); },
    async setUserFlair(options: object): Promise<void> {
      calls.push(`setUserFlair:${JSON.stringify(options)}`);
    },
    async setPostFlair(options: object): Promise<void> {
      calls.push(`setPostFlair:${JSON.stringify(options)}`);
    },
    async remove(id: string): Promise<void> { calls.push(`remove:${id}`); },
    async banUser(options: object): Promise<void> { calls.push(`banUser:${JSON.stringify(options)}`); },
    async unbanUser(user: string, subreddit: string): Promise<void> {
      calls.push(`unbanUser:${user}:${subreddit}`);
    },
    async muteUser(options: object): Promise<void> { calls.push(`muteUser:${JSON.stringify(options)}`); },
    async unmuteUser(user: string, subreddit: string): Promise<void> {
      calls.push(`unmuteUser:${user}:${subreddit}`);
    },
    async sendPrivateMessage(options: object): Promise<void> {
      calls.push(`sendPrivateMessage:${JSON.stringify(options)}`);
    },
    async addModNote(): Promise<object> { return { id: 'ModNote_created' }; },
    async deleteModNote(options: object): Promise<void> {
      calls.push(`deleteModNote:${JSON.stringify(options)}`);
    },
    modMail: {
      async getConversations(): Promise<object> {
        calls.push('modMail.getConversations');
        return {
          conversationIds: ['abc'],
          conversations: {
            abc: {
              id: 'abc',
              subject: 'Hello',
              subreddit: { id: 't5_test', displayName: 'catgirlcoin' },
              conversationType: 'sr_user',
              participant: {
                id: 't2_member',
                name: 'Member',
                isParticipant: true,
              },
              lastUpdated: '2026-09-22T00:00:00Z',
              state: 'InProgress',
              messages: {
                m1: {
                  id: 'm1',
                  bodyMarkdown: 'hello',
                  date: '2026-09-22T00:00:00Z',
                  author: { id: 't2_member', name: 'Member', isParticipant: true },
                },
              },
            },
          },
        };
      },
      async getConversation(): Promise<object> {
        calls.push('modMail.getConversation');
        return {
          conversation: {
            id: 'abc',
            subject: 'Hello',
            subreddit: { id: 't5_test', displayName: 'catgirlcoin' },
            conversationType: 'sr_user',
            participant: { id: 't2_member', name: 'Member', isParticipant: true },
            lastUpdated: '2026-09-22T00:00:00Z',
            state: 'New',
            messages: {},
          },
        };
      },
      async reply(options: { body: string }): Promise<void> {
        state.modmailReplies.push(options.body);
      },
      async archiveConversation(id: string): Promise<void> { calls.push(`archive:${id}`); },
      async muteConversation(options: object): Promise<void> { calls.push(`mute:${JSON.stringify(options)}`); },
      async unmuteConversation(id: string): Promise<void> { calls.push(`unmute:${id}`); },
    },
  };

  return { roots: { reddit, media: {} }, calls, state };
};

describe('legacy Reddit compatibility adapter', () => {
  test('returns the legacy account shape from Devvit app identity', async () => {
    const { roots } = baseRoots();
    const result = await request(roots, { method: 'GET', path: '/api/v1/me' });
    expect(result).toEqual({
      supported: true,
      status: 200,
      body: {
        id: 'mae',
        name: 'this_is_the_mae',
        created_utc: 1704067200,
        link_karma: 12,
        comment_karma: 34,
      },
    });
  });

  test('maps new post listings into the old Reddit Listing envelope', async () => {
    const { roots } = baseRoots();
    const result = await request(roots, {
      method: 'GET',
      path: '/r/catgirlcoin/new',
      query: { limit: '25' },
    });
    expect(result.supported).toBe(true);
    if (!result.supported) return;
    const body = result.body as { data?: { children?: readonly { data?: { name?: string } }[] } };
    expect(body.data?.children?.[0]?.data?.name).toBe('t3_abc');
  });

  test('routes subreddit rules through Devvit', async () => {
    const { roots, calls } = baseRoots();
    const result = await request(roots, {
      method: 'GET',
      path: '/r/catgirlcoin/about/rules',
    });
    expect(result.supported).toBe(true);
    expect(calls).toContain('getRules');
  });

  test('translates legacy self-post form data into Devvit submitPost', async () => {
    const { roots, calls } = baseRoots();
    const result = await request(roots, {
      method: 'POST',
      path: '/api/submit',
      form: {
        kind: 'self',
        sr: 'catgirlcoin',
        title: 'Hello',
        text: 'Body',
        flair_id: 'flair',
        sendreplies: 'true',
      },
    });
    expect(result).toEqual({
      supported: true,
      status: 200,
      body: {
        json: {
          errors: [],
          data: {
            id: 'created',
            name: 't3_created',
            url: 'https://reddit.com/r/catgirlcoin/comments/abc',
          },
        },
      },
    });
    expect(calls.some(value => value.startsWith('submitPost:'))).toBe(true);
  });

  test('maps Modmail reads into the old Modmail response shape', async () => {
    const { roots } = baseRoots();
    const result = await request(roots, {
      method: 'GET',
      path: '/api/mod/conversations',
      query: { entity: 'catgirlcoin', limit: '100', sort: 'recent', state: 'all' },
    });
    expect(result.supported).toBe(true);
    if (!result.supported) return;
    const body = result.body as {
      conversations?: Readonly<Record<string, {
        state?: string;
        messages?: Readonly<Record<string, { bodyMarkdown?: string }>>;
      }>>;
    };
    expect(body.conversations?.['abc']?.state).toBe('inprogress');
    expect(body.conversations?.['abc']?.messages?.['m1']?.bodyMarkdown).toBe('hello');
  });

  test('routes Modmail replies through the nested Devvit service', async () => {
    const { roots, state } = baseRoots();
    const result = await request(roots, {
      method: 'POST',
      path: '/api/mod/conversations/abc',
      form: { body: 'reply', isInternal: 'false', isAuthorHidden: 'false' },
    });
    expect(result.supported).toBe(true);
    expect(state.modmailReplies).toEqual(['reply']);
  });

  test('routes Mod Note deletion through Devvit', async () => {
    const { roots, calls } = baseRoots();
    const result = await request(roots, {
      method: 'DELETE',
      path: '/api/mod/notes',
      query: {
        note_id: 'ModNote_abc',
        subreddit: 'catgirlcoin',
        user: 'Member',
      },
    });
    expect(result.supported).toBe(true);
    expect(calls.some(value => value.startsWith('deleteModNote:'))).toBe(true);
  });

  test.each([
    ['GET', '/api/v1/catgirlcoin/emojis/all'],
    ['GET', '/r/catgirlcoin/comments'],
    ['POST', '/api/comment'],
    ['POST', '/api/read_message'],
    ['POST', '/r/catgirlcoin/api/flairselector'],
    ['POST', '/api/submit_gallery_post.json'],
  ] as const)('leaves unsupported legacy capability %s %s to OAuth', async (method, path) => {
    const { roots } = baseRoots();
    expect(await request(roots, { method, path })).toEqual({ supported: false });
  });

  test('rejects unknown endpoints instead of guessing a translation', async () => {
    const { roots } = baseRoots();
    expect(await request(roots, {
      method: 'GET',
      path: '/api/something-we-did-not-map',
    })).toEqual({ supported: false });
  });
});
