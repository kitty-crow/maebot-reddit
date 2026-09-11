import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManualReputationModeration } from '../src/reputation/manualModeration.ts';
import type { RedditFlairAssignment } from '../src/reddit/types.ts';
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

type Relationship = { username: string; note: string | null; date: number | null };

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
  const live: {
    assignments: RedditFlairAssignment[];
    banned: Relationship[];
    muted: Relationship[];
  } = { assignments: [], banned: [], muted: [] };
  const readerCalls: string[] = [];
  const reader = {
    userFlairAssignment: async (_subreddit: string, username: string) => {
      readerCalls.push(`flair:${username}`);
      return live.assignments.find(item => item.username.toLowerCase() === username.toLowerCase()) ?? null;
    },
    bannedUser: async (_subreddit: string, username: string) => {
      readerCalls.push(`banned:${username}`);
      return live.banned.find(item => item.username.toLowerCase() === username.toLowerCase()) ?? null;
    },
    mutedUser: async (_subreddit: string, username: string) => {
      readerCalls.push(`muted:${username}`);
      return live.muted.find(item => item.username.toLowerCase() === username.toLowerCase()) ?? null;
    },
    userFlairAssignments: async (_subreddit: string) => live.assignments,
    bannedUsers: async (_subreddit: string) => live.banned,
    mutedUsers: async (_subreddit: string) => live.muted,
  };
  const service = new ManualReputationModeration(stateFile, 'catgirlcoin', writer, reader);
  return { store, service, calls, live, readerCalls };
};

const actor = { platform: 'discord' as const, userId: '7', userName: 'kitty' };
const rootMap = (raw: Json): JsonMap => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('bad root');
  return raw;
};
const user = (raw: Json): JsonMap => {
  const root = rootMap(raw);
  const users = root['users'];
  if (typeof users !== 'object' || users === null || Array.isArray(users)) throw new Error('bad users');
  const alice = users['alice'];
  if (typeof alice !== 'object' || alice === null || Array.isArray(alice)) throw new Error('bad alice');
  return alice;
};
const discipline = (raw: Json): JsonMap => {
  const root = rootMap(raw);
  const records = root['discipline'];
  if (typeof records !== 'object' || records === null || Array.isArray(records)) throw new Error('bad discipline');
  const alice = records['alice'];
  if (typeof alice !== 'object' || alice === null || Array.isArray(alice)) throw new Error('bad discipline record');
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

  test('stores flair intent without synchronously mutating Reddit', async () => {
    const { store, service, calls } = await fixture();
    await service.apply('alice', { kind: 'set-flair', flair: 'Trusted Member' }, actor);
    const alice = user(await store.read());
    expect(calls).toEqual([]);
    expect(alice['currentFlairTemplateId']).toBeNull();
    expect(alice['desiredFlairTemplateId']).toBe('trusted-id');
    expect(alice['desiredFlairText']).toBe('Trusted Member');
    expect(alice['needsFlair']).toBe(true);
  });

  test('ban and unban only change canonical status and neutralise stale ban effects', async () => {
    const { store, service, calls } = await fixture();
    await store.edit(current => {
      const value = rootMap(current);
      const contributions = value['contributions'];
      if (typeof contributions !== 'object' || contributions === null || Array.isArray(contributions)) throw new Error('bad contributions');
      contributions['t1_old'] = { fullname: 't1_old', author: 'alice', banRequired: true, banApplied: false };
      return value;
    });
    await service.apply('alice', { kind: 'ban' }, actor);
    expect(user(await store.read())['status']).toBe('banned');
    await service.apply('alice', { kind: 'unban' }, actor);
    const raw = rootMap(await store.read());
    expect(user(raw)['status']).toBe('ordinary');
    const contributions = raw['contributions'];
    if (typeof contributions !== 'object' || contributions === null || Array.isArray(contributions)) throw new Error('bad contributions');
    const old = contributions['t1_old'];
    if (typeof old !== 'object' || old === null || Array.isArray(old)) throw new Error('bad contribution');
    expect(old['banApplied']).toBe(true);
    expect(calls).toEqual([]);
  });

  test('mute and unmute store desired discipline without pretending Reddit already changed', async () => {
    const { store, service, calls } = await fixture();
    await service.apply('alice', { kind: 'mute' }, actor);
    const muted = discipline(await store.read());
    expect(typeof muted['muteUntil']).toBe('number');
    expect(muted['redditMuted']).toBe(false);

    await service.apply('alice', { kind: 'unmute' }, actor);
    const unmuted = discipline(await store.read());
    expect(unmuted['muteUntil']).toBeNull();
    expect(unmuted['mutePermanent']).toBe(false);
    expect(unmuted['redditMuted']).toBe(false);
    expect(calls).toEqual([]);
  });

  test('adopts live canonical Reddit ban, mute and known flair through targeted one-user reads without writing to Reddit', async () => {
    const { store, service, calls, live, readerCalls } = await fixture();
    const startedAt = Math.floor(Date.now() / 1_000) - 60;
    live.assignments.push({
      username: 'Alice',
      templateId: 'trusted-id',
      text: 'Trusted Member',
      cssClass: 'trusted',
    });
    live.banned.push({ username: 'ALICE', note: 'human moderation', date: startedAt });
    live.muted.push({ username: 'alice', note: 'human moderation', date: startedAt });

    const result = await service.apply(
      'alice',
      { kind: 'set-flair', flair: '__MAE_INTERNAL_ADOPT_REDDIT_STATE_V1__' },
      actor,
    );
    const raw = await store.read();
    const alice = user(raw);
    const mute = discipline(raw);

    expect(result.kind).toBe('adopt-reddit-state');
    expect(result.detail).toContain('adopted live r/catgirlcoin state');
    expect(alice['status']).toBe('banned');
    expect(alice['currentFlairTemplateId']).toBe('trusted-id');
    expect(alice['desiredFlairTemplateId']).toBe('trusted-id');
    expect(alice['needsFlair']).toBe(false);
    expect(mute['redditMuted']).toBe(true);
    expect(typeof mute['muteUntil']).toBe('number');
    expect(readerCalls).toEqual(['flair:alice', 'banned:alice', 'muted:alice']);
    expect(calls).toEqual([]);
  });

  test('adopt live accepts ambiguous legacy/custom flair instead of rejecting the native state', async () => {
    const { store, service, calls, live } = await fixture();
    await store.edit(current => {
      const value = rootMap(current);
      const catalog = value['flairCatalog'];
      if (typeof catalog !== 'object' || catalog === null || Array.isArray(catalog)) throw new Error('bad catalog');
      catalog['user'] = [
        { id: 'a', text: 'same', cssClass: 'same-css' },
        { id: 'b', text: 'same', cssClass: 'same-css' },
      ];
      return value;
    });
    live.assignments.push({ username: 'alice', templateId: null, text: 'same', cssClass: 'same-css' });

    const result = await service.apply('alice', { kind: 'adopt-reddit-state' }, actor);
    const alice = user(await store.read());
    expect(result.detail).toContain('(native/custom)');
    expect(alice['currentFlairText']).toBe('same');
    expect(alice['currentFlairCssClass']).toBe('same-css');
    expect(alice['desiredFlairTemplateId']).toBeNull();
    expect(alice['needsFlair']).toBe(false);
    expect(calls).toEqual([]);
  });

  test('adopting live unbanned/unmuted/no-flair state neutralises only that user old pending enforcement', async () => {
    const { store, service, calls } = await fixture();
    await store.edit(current => {
      const value = rootMap(current);
      const alice = user(value);
      alice['status'] = 'banned';
      alice['currentFlairTemplateId'] = 'trusted-id';
      alice['currentFlairText'] = 'Trusted Member';
      alice['desiredFlairTemplateId'] = 'trusted-id';
      alice['desiredFlairText'] = 'Trusted Member';
      const records = value['discipline'];
      if (typeof records !== 'object' || records === null || Array.isArray(records)) throw new Error('bad discipline');
      records['alice'] = {
        muteUntil: null,
        mutePermanent: true,
        redditMuted: true,
        muteAppliedAt: Date.now(),
      };
      const contributions = value['contributions'];
      if (typeof contributions !== 'object' || contributions === null || Array.isArray(contributions)) throw new Error('bad contributions');
      contributions['t1_old'] = {
        fullname: 't1_old',
        author: 'alice',
        banRequired: true,
        banApplied: false,
      };
      contributions['t1_other'] = {
        fullname: 't1_other',
        author: 'bob',
        banRequired: true,
        banApplied: false,
      };
      return value;
    });

    await service.apply('alice', { kind: 'adopt-reddit-state' }, actor);
    const raw = await store.read();
    const alice = user(raw);
    const mute = discipline(raw);
    const value = rootMap(raw);
    const contributions = value['contributions'];
    if (typeof contributions !== 'object' || contributions === null || Array.isArray(contributions)) throw new Error('bad contributions');
    const old = contributions['t1_old'];
    const other = contributions['t1_other'];
    if (typeof old !== 'object' || old === null || Array.isArray(old)) throw new Error('bad old contribution');
    if (typeof other !== 'object' || other === null || Array.isArray(other)) throw new Error('bad other contribution');

    expect(alice['status']).toBe('ordinary');
    expect(alice['currentFlairTemplateId']).toBeNull();
    expect(alice['desiredFlairTemplateId']).toBeNull();
    expect(alice['needsFlair']).toBe(false);
    expect(mute['mutePermanent']).toBe(false);
    expect(mute['redditMuted']).toBe(false);
    expect(old['banApplied']).toBe(true);
    expect(other['banApplied']).toBe(false);
    expect(calls).toEqual([]);
  });
});
