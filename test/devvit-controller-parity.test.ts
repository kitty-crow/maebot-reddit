import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RedditAuthCfg } from '../src/env.ts';
import { MemberModNotesRedditClient } from '../src/modnotes/reddit.ts';
import { RedditReadClient } from '../src/reddit/client.ts';
import { DevvitRpcSpool, type DevvitRpcCommand, type DevvitWire } from '../src/reddit/devvitRpc.ts';
import { RedditMediaClient } from '../src/reddit/media.ts';
import { RedditMutationClient } from '../src/reddit/mutate.ts';

const roots: string[] = [];

const setup = async (): Promise<{
  readonly cfg: RedditAuthCfg;
  readonly spool: DevvitRpcSpool;
}> => {
  const root = await mkdtemp(join(tmpdir(), 'mae-devvit-parity-'));
  roots.push(root);
  const file = join(root, 'devvitRpc.pb');
  return {
    cfg: {
      username: 'this_is_the_mae',
      devvitRpcStateFile: file,
      devvitRpcTimeoutMs: 2_000,
    },
    spool: new DevvitRpcSpool(file),
  };
};

const next = async (spool: DevvitRpcSpool): Promise<DevvitRpcCommand> => {
  const commands = await spool.waitForWork(1, 1_000);
  const command = commands[0];
  if (command === undefined) throw new Error('Expected a Devvit RPC command');
  return command;
};

const succeed = async (
  spool: DevvitRpcSpool,
  command: DevvitRpcCommand,
  value: DevvitWire = null,
): Promise<void> => {
  await spool.complete({ id: command.id, ok: true, value });
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async root => await rm(root, { recursive: true, force: true })));
});

describe('Devvit generic Reddit controller parity', () => {
  test('Mae read client sees Devvit as Reddit', async () => {
    const { cfg, spool } = await setup();
    const client = new RedditReadClient(cfg);

    const pending = client.me();
    const command = await next(spool);
    expect(command).toEqual({
      id: command.id,
      root: 'reddit',
      steps: [{ kind: 'call', name: 'getAppUser', args: [] }],
    });
    await succeed(spool, command, {
      id: 't2_mae',
      username: 'this_is_the_mae',
      createdAt: '2026-01-01T00:00:00.000Z',
      linkKarma: 12,
      commentKarma: 34,
    });

    expect(await pending).toEqual({
      id: 'mae',
      name: 'this_is_the_mae',
      createdUtc: 1_767_225_600,
      linkKarma: 12,
      commentKarma: 34,
    });
  });

  test('Mae write client submits through the generic Reddit controller', async () => {
    const { cfg, spool } = await setup();
    const client = new RedditMutationClient(cfg);

    const pending = client.submitSelf('catgirlcoin', 'title', 'body', 'flair-id');
    const command = await next(spool);
    expect(command.root).toBe('reddit');
    expect(command.steps).toEqual([{
      kind: 'call',
      name: 'submitPost',
      args: [{
        subredditName: 'catgirlcoin',
        title: 'title',
        text: 'body',
        sendreplies: true,
        flairId: 'flair-id',
      }],
    }]);
    await succeed(spool, command, {
      id: 't3_abc',
      url: 'https://www.reddit.com/r/catgirlcoin/comments/abc/example/',
    });

    expect(await pending).toEqual({
      id: 'abc',
      fullname: 't3_abc',
      url: 'https://www.reddit.com/r/catgirlcoin/comments/abc/example/',
    });
  });

  test('object navigation remains generic for Reddit model methods', async () => {
    const { cfg, spool } = await setup();
    const client = new RedditMutationClient(cfg);

    const pending = client.markPrivateMessageRead('t4_message');
    const command = await next(spool);
    expect(command.steps).toEqual([
      { kind: 'call', name: 'getMessages', args: [{ type: 'inbox', limit: 1000, pageSize: 100 }] },
      { kind: 'call', name: 'all', args: [] },
      { kind: 'find', name: 'id', equals: 't4_message' },
      { kind: 'call', name: 'markAsRead', args: [] },
    ]);
    await succeed(spool, command);
    await pending;
  });

  test('media bytes are handed to the Devvit media capability without changing Mae API', async () => {
    const { cfg, spool } = await setup();
    const client = new RedditMediaClient(cfg);

    const pending = client.uploadMedia('image.png', 'image/png', new Uint8Array([1, 2, 3]));
    const command = await next(spool);
    expect(command.root).toBe('media');
    expect(command.steps[0]?.kind).toBe('call');
    if (command.steps[0]?.kind !== 'call') throw new Error('Expected media call');
    expect(command.steps[0].name).toBe('upload');
    const argument = command.steps[0].args[0];
    expect(typeof argument).toBe('object');
    if (typeof argument !== 'object' || argument === null || Array.isArray(argument)) {
      throw new Error('Expected media upload object');
    }
    expect(argument['type']).toBe('image');
    expect(String(argument['url'])).toStartWith('data:image/png;base64,');
    await succeed(spool, command, {
      mediaId: 'asset',
      mediaUrl: 'https://i.redd.it/example.png',
    });
    expect(await pending).toBe('https://i.redd.it/example.png');
  });

  test('native Mod Notes use the same generic Reddit controller', async () => {
    const { cfg, spool } = await setup();
    const client = new MemberModNotesRedditClient(cfg);

    const pending = client.addModNote(
      'catgirlcoin',
      'Member',
      'Helpful member.',
      'HELPFUL_USER',
      't1_comment',
    );
    const command = await next(spool);
    expect(command.steps).toEqual([{
      kind: 'call',
      name: 'addModNote',
      args: [{
        subreddit: 'catgirlcoin',
        user: 'Member',
        note: 'Helpful member.',
        label: 'HELPFUL_USER',
        redditId: 't1_comment',
      }],
    }]);
    await succeed(spool, command, { id: 'ModNote_test' });
    expect(await pending).toBe('ModNote_test');
  });

  test('unsupported subreddit comment listing falls back to the existing Reddit API', async () => {
    const { cfg } = await setup();
    const legacyCfg: RedditAuthCfg = {
      ...cfg,
      legacyOauth: {
        clientId: 'client',
        clientSecret: 'secret',
        password: 'password',
        userAgent: 'test-agent',
      },
    };
    const calls: string[] = [];
    const client = new RedditReadClient(legacyCfg, {
      fetcher: async input => {
        const url = String(input);
        calls.push(url);
        if (url.includes('/api/v1/access_token')) {
          return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 });
        }
        return new Response(JSON.stringify({
          data: {
            after: null,
            children: [{
              kind: 't1',
              data: {
                id: 'comment',
                name: 't1_comment',
                subreddit: 'catgirlcoin',
                link_id: 't3_post',
                parent_id: 't3_post',
                author: 'Member',
                body: 'hello',
                permalink: '/r/catgirlcoin/comments/post/title/comment/',
                created_utc: 1_700_000_000,
                score: 3,
                stickied: false,
              },
            }],
          },
        }), { status: 200 });
      },
    });

    const comments = await client.newComments('catgirlcoin', 25);
    expect(comments.map(comment => comment.fullname)).toEqual(['t1_comment']);
    expect(calls.some(url => url.includes('/r/catgirlcoin/comments'))).toBe(true);
  });

  test('fallback credentials do not divert supported Mae media away from Devvit', async () => {
    const { cfg, spool } = await setup();
    const client = new RedditMediaClient({
      ...cfg,
      legacyOauth: {
        clientId: 'client',
        clientSecret: 'secret',
        password: 'password',
        userAgent: 'test-agent',
      },
    });

    const pending = client.uploadMedia('image.png', 'image/png', new Uint8Array([1, 2, 3]));
    const command = await next(spool);
    expect(command.root).toBe('media');
    expect(command.steps[0]?.kind).toBe('call');
    if (command.steps[0]?.kind !== 'call') throw new Error('Expected Devvit media call');
    expect(command.steps[0].name).toBe('upload');
    await succeed(spool, command, {
      mediaId: 'asset',
      mediaUrl: 'https://i.redd.it/example.png',
    });
    expect(await pending).toBe('https://i.redd.it/example.png');
  });

  test('main-account announcements bypass Devvit and use the existing OAuth transport', async () => {
    const { cfg, spool } = await setup();
    const announcementCfg: RedditAuthCfg = {
      ...cfg,
      username: 'main-user',
      transport: 'legacy',
      legacyOauth: {
        clientId: 'client',
        clientSecret: 'secret',
        password: 'main-password',
        userAgent: 'main-agent',
      },
    };
    const calls: string[] = [];
    const client = new RedditMutationClient(announcementCfg, {
      fetcher: async input => {
        const url = String(input);
        calls.push(url);
        if (url.includes('/api/v1/access_token')) {
          return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 });
        }
        return new Response(JSON.stringify({
          json: {
            errors: [],
            data: {
              id: 'announcement',
              name: 't3_announcement',
              url: 'https://reddit.com/comments/announcement',
            },
          },
        }), { status: 200 });
      },
    });

    expect(await client.submitSelf('nyaonearth', 'Announcement', 'Body', 'flair')).toEqual({
      id: 'announcement',
      fullname: 't3_announcement',
      url: 'https://reddit.com/comments/announcement',
    });
    expect(calls.some(url => url.includes('/api/submit'))).toBe(true);
    expect(await spool.lease(1)).toEqual([]);
  });

  test('Mae RPC Promise resolves from result arrival rather than interval polling', async () => {
    const { cfg, spool } = await setup();
    const client = new RedditReadClient(cfg);

    const pending = client.me();
    const command = await next(spool);
    await spool.complete({
      id: command.id,
      ok: false,
      error: 'synthetic controller failure',
    });
    await expect(pending).rejects.toThrow('synthetic controller failure');
  });
});
