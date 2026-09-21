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
      steps: [{ kind: 'call', name: 'getCurrentUser', args: [] }],
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

  test('CommentSubmit events satisfy Mae newComments without changing Mae callers', async () => {
    const { cfg, spool } = await setup();
    await spool.recordComment({
      comment: {
        id: 't1_comment',
        postId: 't3_post',
        parentId: 't3_post',
        body: 'hello',
        permalink: '/r/catgirlcoin/comments/post/title/comment/',
        createdAt: 1_700_000_000_000,
        score: 3,
        stickied: false,
      },
      subreddit: { name: 'catgirlcoin' },
      author: { name: 'Member' },
      post: {
        title: 'Title',
        authorName: 'Poster',
        permalink: '/r/catgirlcoin/comments/post/title/',
        linkFlair: { text: 'Question' },
      },
    });

    const comments = await new RedditReadClient(cfg).newComments('catgirlcoin', 25);
    expect(comments).toEqual([{
      id: 'comment',
      fullname: 't1_comment',
      subreddit: 'catgirlcoin',
      submissionFullname: 't3_post',
      parentFullname: 't3_post',
      submissionTitle: 'Title',
      submissionAuthor: 'Poster',
      submissionPermalink: '/r/catgirlcoin/comments/post/title/',
      submissionFlairText: 'Question',
      author: 'Member',
      body: 'hello',
      permalink: '/r/catgirlcoin/comments/post/title/comment/',
      createdUtc: 1_700_000_000,
      distinguished: null,
      stickied: false,
      removedByCategory: null,
      score: 3,
      mediaUrls: [],
    }]);
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
