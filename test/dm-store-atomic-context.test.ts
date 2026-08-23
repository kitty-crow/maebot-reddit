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

const message: RedditDirectMessage = {
  id: 'live',
  fullname: 't4_live',
  author: 'SomeUser',
  destination: 'this_is_the_mae',
  subject: 'Hello',
  body: 'Hello Mae',
  createdUtc: 100,
  parentFullname: null,
  firstMessageFullname: 't4_root',
  isNew: true,
  wasComment: false,
};

const clean: ModerationClassification = {
  verdict: 'clean',
  rule: 'none',
  disposition: 'allow',
  penaltyPoints: 0,
  confidence: 1,
  reason: 'clean',
  evidence: [],
};

const fixture = async (): Promise<DmStore> => {
  const root = await mkdtemp(join(tmpdir(), 'mae-dm-atomic-'));
  roots.push(root);
  const store = new DmStore(join(root, 'dm.pb'));
  await store.seed([], 1);
  await store.begin(message);
  return store;
};

test('DM classification and moderation conversation id commit in one store transaction', async () => {
  const store = await fixture();
  await store.setClassificationWithConversation('t4_live', clean, 't4_root', 'SomeUser', 'conv_mod');

  expect((await store.state('t4_live'))?.classification).toEqual(clean);
  expect(await store.conversation('t4_root', 'SomeUser')).toEqual({
    username: 'SomeUser',
    moderationConversationId: 'conv_mod',
    responseConversationId: null,
  });
});

test('DM reply decision and Mae conversation id commit together for reply and no-reply outcomes', async () => {
  const store = await fixture();
  await store.setClassificationWithConversation('t4_live', clean, 't4_root', 'SomeUser', 'conv_mod');
  await store.markModerated('t4_live');
  await store.setReplyWithConversation('t4_live', 'Hi from Mae', 't4_root', 'SomeUser', 'conv_mae');

  expect(await store.state('t4_live')).toMatchObject({ generatedReply: 'Hi from Mae', delivery: 'pending' });
  expect(await store.conversation('t4_root', 'SomeUser')).toEqual({
    username: 'SomeUser',
    moderationConversationId: 'conv_mod',
    responseConversationId: 'conv_mae',
  });

  const second: RedditDirectMessage = { ...message, id: 'second', fullname: 't4_second' };
  await store.begin(second);
  await store.setClassificationWithConversation('t4_second', clean, 't4_root', 'SomeUser', 'conv_mod');
  await store.markModerated('t4_second');
  await store.markNoReplyWithConversation('t4_second', 200, 't4_root', 'SomeUser', 'conv_mae_2');
  expect(await store.state('t4_second')).toMatchObject({ generatedReply: null, delivery: 'no-reply', processedAt: 200 });
  expect((await store.conversation('t4_root', 'SomeUser')).responseConversationId).toBe('conv_mae_2');
});

test('a persisted DM thread cannot silently change correspondent identity', async () => {
  const store = await fixture();
  await store.conversation('t4_root', 'SomeUser');
  await expect(store.conversation('t4_root', 'DifferentUser')).rejects.toThrow('changed correspondent identity');
});
