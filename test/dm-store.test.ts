import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModerationClassification } from '../src/mod/classifier.ts';
import { DmStore } from '../src/dm/store.ts';
import type { RedditDirectMessage } from '../src/dm/types.ts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const message = (id: string): RedditDirectMessage => ({
  id,
  fullname: `t4_${id}`,
  author: 'SomeUser',
  destination: 'this_is_the_mae',
  subject: 'Hello',
  body: 'Hello Mae',
  createdUtc: 100,
  parentFullname: null,
  firstMessageFullname: null,
  isNew: true,
  wasComment: false,
});

const clean: ModerationClassification = {
  verdict: 'clean',
  rule: 'none',
  disposition: 'allow',
  penaltyPoints: 0,
  confidence: 1,
  reason: 'clean',
  evidence: [],
};

const store = async (): Promise<DmStore> => {
  const root = await mkdtemp(join(tmpdir(), 'mae-dm-store-'));
  roots.push(root);
  return new DmStore(join(root, 'dm.pb'));
};

test('Reddit DM store seeds history without making it replyable', async () => {
  const value = await store();
  expect(await value.hasBootstrap()).toBe(false);
  expect(await value.seed([message('old')], 200)).toBe(1);
  expect(await value.hasBootstrap()).toBe(true);
  expect((await value.begin(message('old'))).delivery).toBe('seeded');
  expect(await value.seed([message('old')], 300)).toBe(0);
});

test('Reddit DM store persists classification before reputation mutation and reply delivery checkpoints', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mae-dm-store-reopen-'));
  roots.push(root);
  const path = join(root, 'dm.pb');
  const first = new DmStore(path);
  await first.seed([], 1);
  await first.begin(message('live'));
  await first.setClassification('t4_live', clean);
  await first.markModerated('t4_live');
  await first.setReply('t4_live', 'Hi from Mae');
  await first.markAttempted('t4_live');

  const reopened = new DmStore(path);
  const state = await reopened.state('t4_live');
  expect(state?.classification).toEqual(clean);
  expect(state?.classificationApplied).toBe(true);
  expect(state?.generatedReply).toBe('Hi from Mae');
  expect(state?.delivery).toBe('attempted');
  expect((await reopened.attempted()).map(item => item.message.fullname)).toEqual(['t4_live']);

  await reopened.markSent('t4_live', 400);
  expect((await reopened.state('t4_live'))?.delivery).toBe('sent');
  expect(await reopened.attempted()).toEqual([]);
});

test('Reddit DM conversations keep moderation and Mae dialogue IDs separate', async () => {
  const value = await store();
  const created = await value.conversation('t4_root', 'SomeUser');
  expect(created).toEqual({
    username: 'SomeUser',
    moderationConversationId: null,
    responseConversationId: null,
  });
  await value.rememberConversations('t4_root', 'SomeUser', 'conv_mod', 'conv_mae');
  expect(await value.conversation('t4_root', 'SomeUser')).toEqual({
    username: 'SomeUser',
    moderationConversationId: 'conv_mod',
    responseConversationId: 'conv_mae',
  });
});
