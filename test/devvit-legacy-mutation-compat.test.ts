import { describe, expect, test } from 'bun:test';
import type { RedditAuthCfg } from '../src/env.ts';
import { RedditMutationClient } from '../src/reddit/mutate.ts';
import {
  handleLegacyMutation,
} from '../devvit/src/server/legacyMutationCompat.ts';
import type { AdapterRoots } from '../devvit/src/server/controller.ts';

const cfg: RedditAuthCfg = {
  clientId: 'legacy-client',
  clientSecret: 'legacy-secret',
  username: 'legacy-user',
  password: 'legacy-password',
  userAgent: 'test',
};

const asUrl = (input: string | URL | Request): URL =>
  new URL(input instanceof Request ? input.url : input.toString());

const formRecord = (body: BodyInit | null | undefined): Readonly<Record<string, string>> => {
  if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
  if (typeof body === 'string') return Object.fromEntries(new URLSearchParams(body).entries());
  return {};
};

const adapterFetcher = (
  roots: AdapterRoots,
): ((input: string | URL | Request, init?: RequestInit) => Promise<Response>) =>
  async (input, init = {}) => {
    const url = asUrl(input);
    if (url.hostname === 'www.reddit.com' && url.pathname === '/api/v1/access_token') {
      return new Response(JSON.stringify({ access_token: 'legacy-token', expires_in: 3600 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    const response = await handleLegacyMutation({
      method: (init.method ?? 'GET') as 'GET' | 'POST' | 'DELETE',
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      form: formRecord(init.body),
    }, roots);

    if (!response.supported) {
      return new Response(JSON.stringify({ error: 'unsupported' }), {
        status: 501,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    });
  };

describe('Devvit legacy Reddit mutation compatibility', () => {
  test('old submitSelf and crosspost clients consume adapter responses unchanged', async () => {
    const calls: unknown[] = [];
    const roots: AdapterRoots = {
      reddit: {
        async submitPost(options: unknown) {
          calls.push(['submitPost', options]);
          return {
            id: 't3_created',
            url: 'https://reddit.com/r/catgirlcoin/comments/created/',
          };
        },
        async crosspost(options: unknown) {
          calls.push(['crosspost', options]);
          return {
            id: 't3_cross',
            url: 'https://reddit.com/r/nyaonearth/comments/cross/',
          };
        },
      },
      media: {},
    };

    const client = new RedditMutationClient(cfg, {
      fetcher: adapterFetcher(roots),
      sleep: async () => {},
      random: () => 0,
    });

    expect(await client.submitSelf('catgirlcoin', 'Title', 'Body', 'flair')).toEqual({
      id: 'created',
      fullname: 't3_created',
      url: 'https://reddit.com/r/catgirlcoin/comments/created/',
    });
    expect(await client.crosspost('nyaonearth', 't3_source', 'Cross', null)).toEqual({
      id: 'cross',
      fullname: 't3_cross',
      url: 'https://reddit.com/r/nyaonearth/comments/cross/',
    });

    expect(calls).toEqual([
      ['submitPost', {
        subredditName: 'catgirlcoin',
        title: 'Title',
        text: 'Body',
        sendreplies: true,
        runAs: 'APP',
        flairId: 'flair',
      }],
      ['crosspost', {
        subredditName: 'nyaonearth',
        postId: 't3_source',
        title: 'Cross',
        sendreplies: true,
        runAs: 'APP',
      }],
    ]);
  });

  test('old moderation and flair methods translate without changing callers', async () => {
    const calls: unknown[] = [];
    const roots: AdapterRoots = {
      reddit: {
        async createUserFlairTemplate(options: unknown) { calls.push(['createUserFlairTemplate', options]); },
        async createPostFlairTemplate(options: unknown) { calls.push(['createPostFlairTemplate', options]); },
        async setUserFlair(options: unknown) { calls.push(['setUserFlair', options]); },
        async setPostFlair(options: unknown) { calls.push(['setPostFlair', options]); },
        async remove(...args: unknown[]) { calls.push(['remove', ...args]); },
        async banUser(options: unknown) { calls.push(['banUser', options]); },
        async unbanUser(...args: unknown[]) { calls.push(['unbanUser', ...args]); },
        async muteUser(options: unknown) { calls.push(['muteUser', options]); },
        async unmuteUser(...args: unknown[]) { calls.push(['unmuteUser', ...args]); },
      },
      media: {},
    };
    const client = new RedditMutationClient(cfg, {
      fetcher: adapterFetcher(roots),
      sleep: async () => {},
      random: () => 0,
    });

    await client.createFlairTemplate('catgirlcoin', 'user', {
      id: 'ignored-source-id',
      text: 'Pawsome',
      cssClass: null,
      textColour: 'dark',
      backgroundColour: '#ffffff',
      modOnly: false,
      textEditable: false,
      allowableContent: 'all',
      maxEmojis: 2,
    });
    await client.setUserFlairTemplate('catgirlcoin', 'Member', 'template', 'Custom');
    await client.setPostFlairTemplate('catgirlcoin', 't3_post', 'post-template');
    await client.remove('t1_comment');
    await client.banUser('catgirlcoin', 'BadUser', 'reason', 'note');
    await client.unbanUser('catgirlcoin', 'BadUser');
    await client.unmuteUser('catgirlcoin', 'NoisyUser');

    expect(calls.map(value => Array.isArray(value) ? value[0] : null)).toEqual([
      'createUserFlairTemplate',
      'setUserFlair',
      'setPostFlair',
      'remove',
      'banUser',
      'unbanUser',
      'unmuteUser',
    ]);
  });

  test('28-day user mute creation stays on OAuth because Devvit exposes no duration', async () => {
    const calls: unknown[] = [];
    const roots: AdapterRoots = {
      reddit: {
        async muteUser(options: unknown) {
          calls.push(options);
        },
      },
      media: {},
    };

    expect(await handleLegacyMutation({
      method: 'POST',
      path: '/r/catgirlcoin/api/friend',
      form: {
        name: 'NoisyUser',
        type: 'muted',
        duration: '28',
        note: 'note',
      },
    }, roots)).toEqual({ supported: false });
    expect(calls).toEqual([]);
  });

  test('old outbound PM, Modmail and sticky calls translate through Devvit', async () => {
    const calls: unknown[] = [];
    const post = {
      async sticky(slot: number) {
        calls.push(['sticky', slot]);
      },
    };
    const roots: AdapterRoots = {
      reddit: {
        async sendPrivateMessage(options: unknown) { calls.push(['sendPrivateMessage', options]); },
        async getPostById(id: string) {
          calls.push(['getPostById', id]);
          return post;
        },
        modMail: {
          async reply(options: unknown) { calls.push(['modMail.reply', options]); return {}; },
          async archiveConversation(id: string) { calls.push(['modMail.archive', id]); return {}; },
          async muteConversation(options: unknown) { calls.push(['modMail.mute', options]); return {}; },
          async unmuteConversation(id: string) { calls.push(['modMail.unmute', id]); return {}; },
        },
      },
      media: {},
    };
    const client = new RedditMutationClient(cfg, {
      fetcher: adapterFetcher(roots),
      sleep: async () => {},
      random: () => 0,
    });

    await client.sendPrivateMessage('Member', 'Hello', 'Body');
    await client.replyModmail('abcdef', 'Reply', { hidden: true, internal: true });
    await client.archiveModmail('abcdef');
    await client.muteModmail('abcdef', 72);
    await client.unmuteModmail('abcdef');
    await client.sticky('t3_post', 2);

    expect(calls).toEqual([
      ['sendPrivateMessage', { to: 'Member', subject: 'Hello', text: 'Body' }],
      ['modMail.reply', {
        conversationId: 'abcdef',
        body: 'Reply',
        isAuthorHidden: true,
        isInternal: true,
      }],
      ['modMail.archive', 'abcdef'],
      ['modMail.mute', { conversationId: 'abcdef', numHours: 72 }],
      ['modMail.unmute', 'abcdef'],
      ['getPostById', 't3_post'],
      ['sticky', 2],
    ]);
  });

  test('flair templates carrying legacy CSS classes stay on OAuth', async () => {
    const calls: unknown[] = [];
    const roots: AdapterRoots = {
      reddit: {
        async createUserFlairTemplate(options: unknown) {
          calls.push(options);
        },
      },
      media: {},
    };

    expect(await handleLegacyMutation({
      method: 'POST',
      path: '/r/catgirlcoin/api/flairtemplate_v2',
      form: {
        flair_type: 'USER_FLAIR',
        text: 'Pawsome',
        css_class: 'pawsome',
        mod_only: 'false',
        text_editable: 'false',
      },
    }, roots)).toEqual({ supported: false });
    expect(calls).toEqual([]);
  });

  test('invalid Mod Note labels and context ids fail closed before Devvit', async () => {
    const calls: unknown[] = [];
    const roots: AdapterRoots = {
      reddit: {
        async addModNote(options: unknown) {
          calls.push(options);
          return { id: 'ModNote_should-not-run' };
        },
      },
      media: {},
    };

    expect(await handleLegacyMutation({
      method: 'POST',
      path: '/api/mod/notes',
      form: {
        subreddit: 'catgirlcoin',
        user: 'Member',
        note: 'note',
        label: 'MADE_UP_LABEL',
      },
    }, roots)).toEqual({ supported: false });

    expect(await handleLegacyMutation({
      method: 'POST',
      path: '/api/mod/notes',
      form: {
        subreddit: 'catgirlcoin',
        user: 'Member',
        note: 'note',
        reddit_id: 't5_not-a-post-or-comment',
      },
    }, roots)).toEqual({ supported: false });

    expect(calls).toEqual([]);
  });

  test('unsupported old mutations fail closed so OAuth can remain the fallback', async () => {
    const roots: AdapterRoots = { reddit: {}, media: {} };

    expect(await handleLegacyMutation({
      method: 'POST',
      path: '/api/comment',
      form: { thing_id: 't4_message', text: 'reply' },
    }, roots)).toEqual({ supported: false });

    expect(await handleLegacyMutation({
      method: 'POST',
      path: '/api/v1/catgirlcoin/emoji.json',
      form: {},
    }, roots)).toEqual({ supported: false });
  });
});
