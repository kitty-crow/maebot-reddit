import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModerationClassification } from '../src/mod/classifier.ts';
import type { RedditFlairTemplate } from '../src/reddit/types.ts';
import { PAWSOME_FLAIR_TEXT } from '../src/reputation/policy.ts';
import { ReputationStore, type ReputationBootstrap } from '../src/reputation/store.ts';
import { isMap, type JsonMap } from '../src/types/json.ts';

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

const bootstrap = (): ReputationBootstrap => ({
  subreddit: 'catgirlcoin',
  at: 100,
  userFlairTemplates: [
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
  ],
  postFlairTemplates: [],
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
    post: { minorAnnouncement: null, announcement: null },
  },
  users: [{
    username: 'Recovering',
    points: -2,
    tier: 0,
    status: 'uncivil',
    currentFlairTemplateId: 'uncivil-id',
    currentFlairText: ' ',
    currentFlairCssClass: 'u',
    desiredFlairTemplateId: 'uncivil-id',
    desiredFlairText: ' ',
    immutableModeratorFlair: false,
    needsFlair: false,
    needsReview: false,
    source: 'status-flair',
    seededAt: 100,
  }],
  coverage: {
    flairAssignments: 1,
    moderators: 0,
    bannedUsers: 0,
    recentPostsScanned: 0,
    recentCommentsScanned: 0,
    recentContributorsWithoutFlair: 0,
    note: 'redemption test',
  },
});

const result = (
  verdict: ModerationClassification['verdict'],
): ModerationClassification => ({
  verdict,
  rule: verdict === 'clean' ? 'none' : verdict === 'scam' ? 'rule_5' : 'rule_2',
  disposition: verdict === 'clean' || verdict === 'low' ? 'allow' : 'remove',
  confidence: 1,
  reason: verdict,
  evidence: [],
});

const user = async (store: ReputationStore, username: string): Promise<JsonMap> => {
  const raw = await store.raw();
  if (!isMap(raw) || !isMap(raw['users'])) throw new Error('users map missing');
  const value = raw['users'][username.toLowerCase()];
  if (!isMap(value)) throw new Error(`u/${username} missing`);
  return value;
};

const apply = async (
  store: ReputationStore,
  fullname: string,
  verdict: ModerationClassification['verdict'],
  score = 1,
): Promise<void> => {
  await store.applyModeration({
    fullname,
    kind: 'comment',
    author: 'Recovering',
    createdAt: 200,
    score,
    classification: result(verdict),
    moderatedAt: 201,
  });
};

const fixture = async (): Promise<ReputationStore> => {
  const root = await mkdtemp(join(tmpdir(), 'mae-redemption-'));
  roots.push(root);
  const store = new ReputationStore(join(root, 'reputation.pb'));
  await store.bootstrap(bootstrap());
  return store;
};

describe('persisted reputation redemption', () => {
  test('clean audited contributions redeem uncivil through warned and zero to ordinary tier one', async () => {
    const store = await fixture();

    await apply(store, 't1_clean1', 'clean');
    expect(await user(store, 'Recovering')).toMatchObject({
      points: -1,
      tier: 0,
      status: 'warned',
      desiredFlairTemplateId: 'warned-id',
      needsFlair: true,
    });

    await store.markFlairApplied('Recovering', 'warned-id', ' ');
    await apply(store, 't1_clean2', 'clean');
    expect(await user(store, 'Recovering')).toMatchObject({
      points: 0,
      tier: 0,
      status: 'warned',
      desiredFlairTemplateId: 'warned-id',
      needsFlair: false,
    });

    await apply(store, 't1_clean3', 'clean');
    const redeemed = await user(store, 'Recovering');
    expect(redeemed['points']).toBe(1);
    expect(redeemed['tier']).toBe(1);
    expect(redeemed['status']).toBe('ordinary');
    expect(['mae-id', 'lisa-id']).toContain(redeemed['desiredFlairTemplateId']);
    expect(redeemed['needsFlair']).toBe(true);
  });

  test('confirmed Reddit score gains on a clean contribution also redeem negative reputation', async () => {
    const store = await fixture();
    await apply(store, 't1_score', 'clean', 1);
    expect((await user(store, 'Recovering'))['points']).toBe(-1);

    expect(await store.observeScore('t1_score', 2, 300)).toBe(0);
    expect(await store.observeScore('t1_score', 2, 301)).toBe(1);
    expect(await user(store, 'Recovering')).toMatchObject({ points: 0, status: 'warned', tier: 0 });

    expect(await store.observeScore('t1_score', 3, 302)).toBe(0);
    expect(await store.observeScore('t1_score', 3, 303)).toBe(1);
    const redeemed = await user(store, 'Recovering');
    expect(redeemed['points']).toBe(1);
    expect(redeemed['status']).toBe('ordinary');
    expect(redeemed['tier']).toBe(1);
  });

  test('one-off score spikes are not credited and violating contributions do not earn score points', async () => {
    const store = await fixture();
    await apply(store, 't1_fuzzy', 'clean', 1);

    expect(await store.observeScore('t1_fuzzy', 5, 400)).toBe(0);
    expect(await store.observeScore('t1_fuzzy', 2, 401)).toBe(0);
    expect(await store.observeScore('t1_fuzzy', 2, 402)).toBe(1);
    expect((await user(store, 'Recovering'))['points']).toBe(0);

    await apply(store, 't1_low', 'low', 1);
    expect((await user(store, 'Recovering'))['points']).toBe(-1);
    expect(await store.observeScore('t1_low', 20, 500)).toBe(0);
    expect(await store.observeScore('t1_low', 20, 501)).toBe(0);
    expect((await user(store, 'Recovering'))['points']).toBe(-1);
  });
});
