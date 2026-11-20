import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DashboardRedditReconciler } from '../src/reputation/dashboardReconcile.ts';
import { Store } from '../src/store/store.ts';
import type { Json, JsonMap } from '../src/types/json.ts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const state = (status: string, muted: boolean, flair = true): JsonMap => ({
  schema: 1,
  subreddit: 'catgirlcoin',
  bootstrappedAt: 1,
  flairCatalog: { user: [{ id: 'trusted-id', text: 'Trusted Member', cssClass: 'trusted' }], post: [] },
  flairReferences: { user: {}, post: {} },
  users: {
    alice: {
      username: 'alice',
      points: 5,
      tier: 1,
      status,
      currentFlairTemplateId: null,
      currentFlairText: null,
      currentFlairCssClass: null,
      desiredFlairTemplateId: flair ? 'trusted-id' : null,
      desiredFlairText: flair ? 'Trusted Member' : null,
      needsFlair: flair,
      immutableModeratorFlair: false,
    },
  },
  contributions: {},
  reputationJournal: {},
  discipline: {
    alice: {
      muteUntil: muted && status !== 'banned' ? Date.now() + 60_000 : null,
      mutePermanent: status === 'banned',
      muteTriggeredAt: muted && status !== 'banned' ? Date.now() : null,
      unmuteRequestedAt: !muted ? Date.now() : null,
      redditMuted: !muted,
      muteAppliedAt: null,
    },
  },
  notices: {},
  coverage: {},
});

const fixture = async (canonical: JsonMap) => {
  const root = await mkdtemp(join(tmpdir(), 'mae-dashboard-reconcile-'));
  roots.push(root);
  const file = join(root, 'reputation.pb');
  const store = new Store(file, canonical as Json);
  await store.edit(() => canonical);
  const live = {
    banned: [] as Array<{ username: string; note: string | null; date: number | null }>,
    muted: [] as Array<{ username: string; note: string | null; date: number | null }>,
    flairs: [] as Array<{ username: string; templateId: string | null; text: string | null; cssClass: string | null }>,
  };
  const calls: string[] = [];
  const reader = {
    bannedUsers: async () => live.banned,
    mutedUsers: async () => live.muted,
    userFlairAssignments: async () => live.flairs,
    bannedUser: async (_subreddit: string, username: string) => live.banned.find(v => v.username === username) ?? null,
    mutedUser: async (_subreddit: string, username: string) => live.muted.find(v => v.username === username) ?? null,
    userFlairAssignment: async (_subreddit: string, username: string) => live.flairs.find(v => v.username === username) ?? null,
  };
  const writer = {
    banUser: async (_subreddit: string, username: string) => { calls.push(`ban:${username}`); },
    unbanUser: async (_subreddit: string, username: string) => { calls.push(`unban:${username}`); },
    muteUser: async (_subreddit: string, username: string) => { calls.push(`mute:${username}`); },
    unmuteUser: async (_subreddit: string, username: string) => { calls.push(`unmute:${username}`); },
    setUserFlairTemplate: async (_subreddit: string, username: string, id: string) => { calls.push(`flair:${username}:${id}`); },
  };
  const runtime = new DashboardRedditReconciler(file, 'catgirlcoin', writer, reader, 60_000);
  return { store, runtime, live, calls };
};

describe('Dashboard Reddit canonical reconciliation', () => {
  test('repairs unban, unmute and flair drift from canonical state', async () => {
    const { store, runtime, live, calls } = await fixture(state('ordinary', false, true));
    live.banned.push({ username: 'alice', note: null, date: 1 });
    live.muted.push({ username: 'alice', note: null, date: 1 });

    await runtime.reconcileAll();

    expect(calls).toEqual(['unban:alice', 'unmute:alice', 'flair:alice:trusted-id']);
    const raw = await store.read();
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('bad root');
    const users = raw['users'];
    const discipline = raw['discipline'];
    if (typeof users !== 'object' || users === null || Array.isArray(users)) throw new Error('bad users');
    if (typeof discipline !== 'object' || discipline === null || Array.isArray(discipline)) throw new Error('bad discipline');
    const alice = users['alice'];
    const mute = discipline['alice'];
    if (typeof alice !== 'object' || alice === null || Array.isArray(alice)) throw new Error('bad user');
    if (typeof mute !== 'object' || mute === null || Array.isArray(mute)) throw new Error('bad mute');
    expect(alice['currentFlairTemplateId']).toBe('trusted-id');
    expect(alice['needsFlair']).toBe(false);
    expect(mute['redditMuted']).toBe(false);
  });

  test('enforces a canonical ban without attempting lower-priority user state', async () => {
    const { runtime, calls } = await fixture(state('banned', true, true));
    await runtime.reconcileAll();
    expect(calls).toEqual(['ban:alice']);
  });

  test('enforces a canonical mute when the live user is currently unmuted', async () => {
    const { runtime, calls } = await fixture(state('ordinary', true, false));
    await runtime.reconcileAll();
    expect(calls).toEqual(['mute:alice']);
  });

  test('does not renew a canonical mute after Mae already applied it once', async () => {
    const canonical = state('ordinary', true, false);
    const discipline = canonical['discipline'];
    if (typeof discipline !== 'object' || discipline === null || Array.isArray(discipline)) throw new Error('bad discipline');
    const alice = discipline['alice'];
    if (typeof alice !== 'object' || alice === null || Array.isArray(alice)) throw new Error('bad mute');
    alice['redditMuted'] = true;
    alice['muteAppliedAt'] = Date.now() - (29 * 24 * 60 * 60 * 1_000);

    const { runtime, calls } = await fixture(canonical);
    await runtime.reconcileAll();
    expect(calls).toEqual([]);
  });

  test('does not claim or reapply a live human-owned mute', async () => {
    const { store, runtime, live, calls } = await fixture(state('ordinary', true, false));
    live.muted.push({ username: 'alice', note: 'manual', date: 1 });

    await runtime.reconcileAll();

    expect(calls).toEqual([]);
    const raw = await store.read();
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('bad root');
    const discipline = raw['discipline'];
    if (typeof discipline !== 'object' || discipline === null || Array.isArray(discipline)) throw new Error('bad discipline');
    const alice = discipline['alice'];
    if (typeof alice !== 'object' || alice === null || Array.isArray(alice)) throw new Error('bad mute');
    expect(alice['redditMuted']).toBe(false);
    expect(typeof alice['muteAppliedAt']).toBe('number');
    expect(alice['muteSkipped']).toBe(true);
  });

  test('does not convert an existing live timed mute to permanent after a fresh ban', async () => {
    const canonical = state('banned', true, false);
    const discipline = canonical['discipline'];
    if (typeof discipline !== 'object' || discipline === null || Array.isArray(discipline)) throw new Error('bad discipline');
    const alice = discipline['alice'];
    if (typeof alice !== 'object' || alice === null || Array.isArray(alice)) throw new Error('bad mute');
    alice['muteTriggeredAt'] = Date.now();
    const { runtime, live, calls, store } = await fixture(canonical);
    live.muted.push({ username: 'alice', note: 'older temporary mute', date: 1 });
    await runtime.reconcileAll();
    expect(calls).toEqual(['ban:alice']);
    const updated = await store.read();
    if (typeof updated !== 'object' || updated === null || Array.isArray(updated)) throw new Error('bad root');
    const records = updated['discipline'];
    if (typeof records !== 'object' || records === null || Array.isArray(records)) throw new Error('bad discipline');
    const record = records['alice'];
    if (typeof record !== 'object' || record === null || Array.isArray(record)) throw new Error('bad record');
    expect(record['muteSkipped']).toBe(true);
    live.muted = [];
    await runtime.reconcileAll();
    expect(calls.filter(call => call.startsWith('mute:'))).toEqual([]);
  });

  test('lets historical timed mutes expire naturally', async () => {
    const canonical = state('ordinary', true, false);
    const discipline = canonical['discipline'];
    if (typeof discipline !== 'object' || discipline === null || Array.isArray(discipline)) throw new Error('bad discipline');
    const alice = discipline['alice'];
    if (typeof alice !== 'object' || alice === null || Array.isArray(alice)) throw new Error('bad mute');
    alice['muteUntil'] = Date.now() - 60_000;
    alice['muteTriggeredAt'] = null;
    alice['redditMuted'] = true;
    alice['muteAppliedAt'] = Date.now() - 28 * 24 * 60 * 60 * 1_000;
    const { runtime, live, calls } = await fixture(canonical);
    live.muted.push({ username: 'alice', note: 'old timed mute', date: 1 });
    await runtime.reconcileAll();
    expect(calls).toEqual([]);
  });
});
