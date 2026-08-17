import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RedditStateStore } from '../src/store/state.ts';

const dirs: string[] = [];

const state = async (): Promise<{ readonly store: RedditStateStore; readonly file: string }> => {
  const dir = await mkdtemp(join(tmpdir(), 'maebot-reddit-state-'));
  dirs.push(dir);
  const file = join(dir, 'reddit.pb');
  return { store: new RedditStateStore(file), file };
};

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(async dir => await rm(dir, { recursive: true, force: true })));
});

describe('Reddit durable state', () => {
  test('action identity is idempotent at the logical side-effect boundary', async () => {
    const { store } = await state();
    const first = await store.ensureAction({
      key: 'reddit:comment:t1_abc:remove:policy-1',
      kind: 'remove',
      target: 't1_abc',
      reason: 'synthetic test',
      policy: 'policy-1',
      createdAt: 1,
      actor: 'mae',
      oldState: { removed: false },
      newState: { removed: true },
      reviewKey: null,
    });
    const second = await store.ensureAction({
      key: 'reddit:comment:t1_abc:remove:policy-1',
      kind: 'remove',
      target: 't1_abc',
      reason: 'must not replace original',
      policy: 'policy-1',
      createdAt: 2,
      actor: 'mae',
      oldState: null,
      newState: null,
      reviewKey: null,
    });
    expect(second).toEqual(first);
    expect((await store.beginAction(first.key))?.state).toBe('applying');
    expect((await store.markActionApplied(first.key, null, 3))?.state).toBe('applied');
    expect(await store.beginAction(first.key)).toBeNull();
  });

  test('Twitter fanout survives restart between primary and legacy delivery without replaying the first', async () => {
    const { store, file } = await state();
    await store.ensureTwitter('tweet1', 'https://twitter.com/NyaOnEarth/status/tweet1', 10, 11);
    const primary = await store.markTwitterDelivery('tweet1', 'primary', 'post1', 'primary', 12);
    expect(primary?.lifecycle).toBe('pending');
    expect(primary?.primary.postId).toBe('post1');
    expect(primary?.legacy.postId).toBeNull();

    const restarted = new RedditStateStore(file);
    const pending = await restarted.pendingTwitter();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.primary.postId).toBe('post1');
    expect(pending[0]?.legacy.postId).toBeNull();

    const legacy = await restarted.markTwitterDelivery('tweet1', 'legacy', 'post2', 'crosspost', 13);
    expect(legacy?.lifecycle).toBe('complete');
    expect(legacy?.primary.postId).toBe('post1');
    expect(legacy?.legacy.postId).toBe('post2');
    expect(await restarted.pendingTwitter()).toHaveLength(0);
  });

  test('review rejection leaves completed Reddit tweet posts intact', async () => {
    const { store } = await state();
    await store.ensureTwitter('tweet2', 'https://twitter.com/NyaOnEarth/status/tweet2', 10, 11);
    await store.markTwitterDelivery('tweet2', 'primary', 'p1', 'primary', 12);
    await store.markTwitterDelivery('tweet2', 'legacy', 'p2', 'crosspost', 13);
    await store.attachTwitterReview('tweet2', 'twitter:nyaonearth:tweet2');
    const rejected = await store.decideTwitterReview('tweet2', 'reject');
    expect(rejected?.reviewDecision).toBe('reject');
    expect(rejected?.primary.postId).toBe('p1');
    expect(rejected?.legacy.postId).toBe('p2');
  });
});
