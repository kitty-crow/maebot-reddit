import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModerationClassification } from '../src/mod/classifier.ts';
import type { RedditFlairTemplate } from '../src/reddit/types.ts';
import { PAWSOME_FLAIR_TEXT, REPUTATION_FLOOR } from '../src/reputation/policy.ts';
import { isMap } from '../src/types/json.ts';
import { ReputationStore, type ReputationBootstrap } from '../src/reputation/store.ts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const template = (id: string, text: string, cssClass: string | null = null): RedditFlairTemplate => ({
  id,
  text,
  cssClass,
  textColour: 'dark',
  backgroundColour: null,
  modOnly: false,
  textEditable: false,
  allowableContent: 'all',
  maxEmojis: 1,
});

const templates = (): readonly RedditFlairTemplate[] => [
  template('mae-id', ':mae:', 'h'),
  template('lisa-id', ':lisa:', 'h'),
  template('kita-id', ':kita:', 'h'),
  template('aoi-id', ':aoi:', 'h'),
  template('hana-id', ':hana:', 'h'),
  template('rin-id', ':rin:', 'h'),
  template('celeste-id', ':celeste:', 'h'),
  template('pawsome-id', PAWSOME_FLAIR_TEXT, 'h'),
  template('warned-id', ' ', 'w'),
  template('uncivil-id', ' ', 'u'),
  template('scam-id', 'SCAM', 's'),
];

const bootstrap = (): ReputationBootstrap => ({
  subreddit: 'catgirlcoin',
  at: 123,
  userFlairTemplates: templates(),
  postFlairTemplates: [
    template('minor-id', 'Minor Announcement :lisa:'),
    template('announcement-id', 'Announcement :catgirl-moon:'),
  ],
  flairReferences: {
    user: {
      mae: 'mae-id',
      lisa: 'lisa-id',
      kita: 'kita-id',
      aoi: 'aoi-id',
      hana: 'hana-id',
      rin: 'rin-id',
      celeste: 'celeste-id',
      pawsomeContributor: 'pawsome-id',
      warned: 'warned-id',
      uncivil: 'uncivil-id',
      scam: 'scam-id',
    },
    post: {
      minorAnnouncement: 'minor-id',
      announcement: 'announcement-id',
    },
  },
  users: [{
    username: 'Alice',
    points: 1,
    tier: 1,
    status: 'ordinary',
    currentFlairTemplateId: 'mae-id',
    currentFlairText: ':mae:',
    currentFlairCssClass: 'h',
    desiredFlairTemplateId: 'mae-id',
    desiredFlairText: ':mae:',
    immutableModeratorFlair: false,
    needsFlair: false,
    needsReview: false,
    source: 'tier-flair',
    seededAt: 123,
  }],
  coverage: {
    flairAssignments: 1,
    moderators: 0,
    bannedUsers: 0,
    recentPostsScanned: 1,
    recentCommentsScanned: 1,
    recentContributorsWithoutFlair: 0,
    note: 'test',
  },
});

const classification = (
  verdict: ModerationClassification['verdict'],
): ModerationClassification => ({
  verdict,
  rule: verdict === 'clean' ? 'none' : verdict === 'scam' ? 'rule_5' : 'rule_6',
  disposition: verdict === 'clean' || verdict === 'low' ? 'allow' : 'remove',
  confidence: 0.99,
  reason: `fixture ${verdict}`,
  evidence: [],
});

const openStore = async (): Promise<{ readonly file: string; readonly store: ReputationStore }> => {
  const root = await mkdtemp(join(tmpdir(), 'mae-reputation-'));
  roots.push(root);
  const file = join(root, 'reputation.pb');
  const store = new ReputationStore(file);
  await store.bootstrap(bootstrap());
  return { file, store };
};

const usersMap = async (store: ReputationStore) => {
  const raw = await store.raw();
  if (!isMap(raw)) throw new Error('reputation snapshot was not a map');
  const users = raw['users'];
  if (!isMap(users)) throw new Error('reputation users were not a map');
  return { raw, users };
};

describe('reputation store', () => {
  test('bootstrap writes one durable protobuf-backed snapshot and refuses accidental reseeding', async () => {
    const fixture = await openStore();
    expect(await fixture.store.hasBootstrap()).toBe(true);

    const reopened = new ReputationStore(fixture.file);
    const { raw, users } = await usersMap(reopened);
    expect(raw['subreddit']).toBe('catgirlcoin');
    expect(raw['bootstrappedAt']).toBe(123);
    const alice = users['alice'];
    expect(isMap(alice)).toBe(true);
    if (!isMap(alice)) throw new Error('Alice reputation record was not a map');
    expect(alice['points']).toBe(1);
    const references = raw['flairReferences'];
    expect(isMap(references)).toBe(true);
    if (!isMap(references)) throw new Error('flair references were not persisted');
    const userRefs = references['user'];
    expect(isMap(userRefs)).toBe(true);
    if (!isMap(userRefs)) throw new Error('user flair references were not persisted');
    expect(userRefs['mae']).toBe('mae-id');
    expect(userRefs['pawsomeContributor']).toBe('pawsome-id');

    await expect(reopened.bootstrap(bootstrap())).rejects.toThrow('already bootstrapped');
  });

  test('one clean contribution mutates user, contribution and journal atomically and is idempotent', async () => {
    const { store } = await openStore();
    const input = {
      fullname: 't1_clean',
      kind: 'comment' as const,
      author: 'Alice',
      createdAt: 200,
      score: 1,
      classification: classification('clean'),
      moderatedAt: 201,
    };
    const first = await store.applyModeration(input);
    const second = await store.applyModeration(input);
    expect(first.points).toBe(2);
    expect(second.points).toBe(2);

    const raw = await store.raw();
    if (!isMap(raw)) throw new Error('reputation snapshot was not a map');
    const contributions = raw['contributions'];
    const journal = raw['reputationJournal'];
    expect(isMap(contributions)).toBe(true);
    expect(isMap(journal)).toBe(true);
    if (!isMap(contributions) || !isMap(journal)) throw new Error('runtime maps were not persisted');
    expect(Object.keys(contributions)).toEqual(['t1_clean']);
    expect(Object.keys(journal)).toEqual(['moderation:t1_clean']);
  });

  test('new clean contributor gets exactly one point and a persisted tier-one flair intent', async () => {
    const { store } = await openStore();
    const user = await store.applyModeration({
      fullname: 't3_new',
      kind: 'post',
      author: 'FreshUser',
      createdAt: 300,
      score: 1,
      classification: classification('clean'),
      moderatedAt: 301,
    });
    expect(user.points).toBe(1);
    expect(user.tier).toBe(1);
    expect(user.needsFlair).toBe(true);
    expect(['mae-id', 'lisa-id']).toContain(user.desiredFlairTemplateId);
    const effects = await store.pendingEffects();
    expect(effects.flairs).toHaveLength(1);
    expect(effects.flairs[0]?.username).toBe('FreshUser');
  });

  test('severe and scam classifications persist removal and ban intents exactly once per contribution', async () => {
    const { store } = await openStore();
    await store.applyModeration({
      fullname: 't1_severe',
      kind: 'comment',
      author: 'Alice',
      createdAt: 400,
      score: 1,
      classification: classification('severe'),
      moderatedAt: 401,
    });
    let effects = await store.pendingEffects();
    expect(effects.removals).toEqual([{ fullname: 't1_severe' }]);
    expect(effects.bans).toEqual([]);
    await store.markRemovalApplied('t1_severe');
    expect((await store.pendingEffects()).removals).toEqual([]);

    await store.applyModeration({
      fullname: 't1_scam',
      kind: 'comment',
      author: 'Scammer',
      createdAt: 500,
      score: 1,
      classification: classification('scam'),
      moderatedAt: 501,
    });
    effects = await store.pendingEffects();
    expect(effects.removals).toContainEqual({ fullname: 't1_scam' });
    expect(effects.bans).toContainEqual({ fullname: 't1_scam', username: 'Scammer' });
    const { users } = await usersMap(store);
    const scammer = users['scammer'];
    expect(isMap(scammer)).toBe(true);
    if (!isMap(scammer)) throw new Error('Scammer user missing');
    expect(scammer['points']).toBe(REPUTATION_FLOOR);
    expect(scammer['status']).toBe('scam');
  });

  test('Reddit score credits use a confirmed high-water and never deduct points', async () => {
    const { store } = await openStore();
    await store.applyModeration({
      fullname: 't1_score',
      kind: 'comment',
      author: 'Alice',
      createdAt: 600,
      score: 7,
      classification: classification('clean'),
      moderatedAt: 601,
    });
    expect(await store.observeScore('t1_score', 11, 610)).toBe(0);
    expect(await store.observeScore('t1_score', 11, 620)).toBe(4);
    let snapshot = await usersMap(store);
    let alice = snapshot.users['alice'];
    expect(isMap(alice)).toBe(true);
    if (!isMap(alice)) throw new Error('Alice missing after score credit');
    expect(alice['points']).toBe(6);

    expect(await store.observeScore('t1_score', 8, 630)).toBe(0);
    expect(await store.observeScore('t1_score', 13, 640)).toBe(0);
    expect(await store.observeScore('t1_score', 13, 650)).toBe(2);
    snapshot = await usersMap(store);
    alice = snapshot.users['alice'];
    expect(isMap(alice)).toBe(true);
    if (!isMap(alice)) throw new Error('Alice missing after second score credit');
    expect(alice['points']).toBe(8);
  });

  test('exempt contribution is recorded without reputation mutation or later score credit', async () => {
    const { store } = await openStore();
    await store.recordExempt('t1_mod', 'comment', 'Moderator', 700, 10, 701);
    expect(await store.hasContribution('t1_mod')).toBe(true);
    expect(await store.observeScore('t1_mod', 50, 710)).toBe(0);
    const effects = await store.pendingEffects();
    expect(effects.flairs).toEqual([]);
    expect(effects.removals).toEqual([]);
    expect(effects.bans).toEqual([]);
  });
});
