import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManualReputationModeration } from '../src/reputation/manualModeration.ts';
import { Store } from '../src/store/store.ts';
import type { Json, JsonMap } from '../src/types/json.ts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const initial = (): JsonMap => ({
  schema: 1,
  subreddit: 'catgirlcoin',
  bootstrappedAt: 1,
  flairCatalog: {
    user: [{ id: 'trusted-id', text: 'Trusted Member', cssClass: 'trusted' }],
    post: [],
  },
  flairReferences: { user: {}, post: {} },
  users: {
    alice: {
      username: 'alice',
      points: 5,
      tier: 0,
      status: 'ordinary',
      currentFlairTemplateId: null,
      currentFlairText: null,
      currentFlairCssClass: null,
      desiredFlairTemplateId: null,
      desiredFlairText: null,
      needsFlair: false,
      immutableModeratorFlair: false,
    },
  },
  contributions: {},
  reputationJournal: {},
  discipline: {},
  notices: {},
  coverage: {},
});

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'mae-manual-user-mod-'));
  roots.push(root);
  const stateFile = join(root, 'reputation.pb');
  const store = new Store(stateFile, initial() as Json);
  await store.edit(current => current);
  const calls: string[] = [];
  const writer = {
    setUserFlairTemplate: async (_subreddit: string, username: string, templateId: string) => {
      calls.push(`flair:${username}:${templateId}`);
    },
    banUser: async (_subreddit: string, username: string) => { calls.push(`ban:${username}`); },
    unbanUser: async (_subreddit: string, username: string) => { calls.push(`unban:${username}`); },
    muteUser: async (_subreddit: string, username: string) => { calls.push(`mute:${username}`); },
    unmuteUser: async (_subreddit: string, username: string) => { calls.push(`unmute:${username}`); },
  };
  const service = new ManualReputationModeration(stateFile, 'catgirlcoin', writer);
  return { store, service, calls };
};

const actor = { platform: 'discord' as const, userId: '7', userName: 'kitty' };
const user = (root: Json): JsonMap => {
  if (typeof root !== 'object' || root === null || Array.isArray(root)) throw new Error('bad root');
  const users = root['users'];
  if (typeof users !== 'object' || users === null || Array.isArray(users)) throw new Error('bad users');
  const alice = users['alice'];
  if (typeof alice !== 'object' || alice === null || Array.isArray(alice)) throw new Error('bad alice');
  return alice;
};

describe('manual Reddit user moderation', () => {
  test('sets canonical score and tier without requiring a native mutation', async () => {
    const { store, service, calls } = await fixture();
    await service.apply('alice', { kind: 'set-score', points: 50 }, actor);
    const alice = user(await store.read());
    expect(alice['points']).toBe(50);
    expect(typeof alice['tier']).toBe('number');
    expect(calls).toEqual([]);
  });

  test('sets native flair and synchronises current and desired canonical flair state', async () => {
    const { store, service, calls } = await fixture();
    await service.apply('alice', { kind: 'set-flair', flair: 'Trusted Member' }, actor);
    const alice = user(await store.read());
    expect(calls).toEqual(['flair:alice:trusted-id']);
    expect(alice['currentFlairTemplateId']).toBe('trusted-id');
    expect(alice['currentFlairText']).toBe('Trusted Member');
    expect(alice['desiredFlairTemplateId']).toBe('trusted-id');
    expect(alice['needsFlair']).toBe(false);
  });

  test('ban and unban update both native Reddit and canonical status', async () => {
    const { store, service, calls } = await fixture();
    await service.apply('alice', { kind: 'ban' }, actor);
    expect(user(await store.read())['status']).toBe('banned');
    await service.apply('alice', { kind: 'unban' }, actor);
    expect(user(await store.read())['status']).toBe('ordinary');
    expect(calls).toEqual(['ban:alice', 'unban:alice']);
  });

  test('mute and unmute call Reddit and persist discipline reconciliation state', async () => {
    const { store, service, calls } = await fixture();
    await service.apply('alice', { kind: 'mute' }, actor);
    let root = await store.read();
    if (typeof root !== 'object' || root === null || Array.isArray(root)) throw new Error('bad root');
    const discipline = root['discipline'];
    if (typeof discipline !== 'object' || discipline === null || Array.isArray(discipline)) throw new Error('bad discipline');
    const record = discipline['alice'];
    if (typeof record !== 'object' || record === null || Array.isArray(record)) throw new Error('bad record');
    expect(record['redditMuted']).toBe(true);

    await service.apply('alice', { kind: 'unmute' }, actor);
    root = await store.read();
    if (typeof root !== 'object' || root === null || Array.isArray(root)) throw new Error('bad root');
    const afterDiscipline = root['discipline'];
    if (typeof afterDiscipline !== 'object' || afterDiscipline === null || Array.isArray(afterDiscipline)) throw new Error('bad discipline');
    const after = afterDiscipline['alice'];
    if (typeof after !== 'object' || after === null || Array.isArray(after)) throw new Error('bad record');
    expect(after['redditMuted']).toBe(false);
    expect(calls).toEqual(['mute:alice', 'unmute:alice']);
  });
});
