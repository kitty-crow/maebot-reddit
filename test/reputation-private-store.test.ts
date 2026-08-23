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
    username: 'PrivateUser',
    points: 5,
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
    seededAt: 100,
  }],
  coverage: {
    flairAssignments: 1,
    moderators: 0,
    bannedUsers: 0,
    recentPostsScanned: 0,
    recentCommentsScanned: 0,
    recentContributorsWithoutFlair: 0,
    note: 'private reputation test',
  },
});

const classification = (
  verdict: ModerationClassification['verdict'],
  penaltyPoints: number,
): ModerationClassification => ({
  verdict,
  rule: verdict === 'clean' ? 'none' : 'rule_2',
  disposition: verdict === 'clean' || verdict === 'low' ? 'allow' : 'remove',
  penaltyPoints,
  confidence: 1,
  reason: verdict,
  evidence: [],
});

const fixture = async (): Promise<ReputationStore> => {
  const root = await mkdtemp(join(tmpdir(), 'mae-private-reputation-'));
  roots.push(root);
  const store = new ReputationStore(join(root, 'reputation.pb'));
  await store.bootstrap(bootstrap());
  return store;
};

const contribution = async (store: ReputationStore, fullname: string): Promise<JsonMap> => {
  const raw = await store.raw();
  if (!isMap(raw) || !isMap(raw['contributions'])) throw new Error('contributions map missing');
  const value = raw['contributions'][fullname];
  if (!isMap(value)) throw new Error(`${fullname} missing`);
  return value;
};

describe('persisted private reputation policy', () => {
  test('clean DM and modmail messages never award positive reputation', async () => {
    const store = await fixture();
    await store.applyModeration({
      fullname: 'dm:t4_abc',
      kind: 'dm',
      author: 'PrivateUser',
      createdAt: 200,
      score: 0,
      permalink: '',
      content: 'Hello Mae',
      classification: classification('clean', 0),
      moderatedAt: 201,
    });
    expect(await store.user('PrivateUser')).toMatchObject({ points: 5, tier: 1, status: 'ordinary' });
    expect(await contribution(store, 'dm:t4_abc')).toMatchObject({ basePointsAwarded: 0, removeRequired: false });

    await store.applyModeration({
      fullname: 'modmail:abc:m1',
      kind: 'modmail',
      author: 'PrivateUser',
      createdAt: 202,
      score: 0,
      permalink: '',
      content: 'Please review this',
      classification: classification('clean', 0),
      moderatedAt: 203,
    });
    expect(await store.user('PrivateUser')).toMatchObject({ points: 5, tier: 1, status: 'ordinary' });
    expect(await contribution(store, 'modmail:abc:m1')).toMatchObject({ basePointsAwarded: 0, removeRequired: false });
  });

  test('private severe behaviour deducts normally but never creates a public removal effect', async () => {
    const store = await fixture();
    await store.applyModeration({
      fullname: 'modmail:abc:m2',
      kind: 'modmail',
      author: 'PrivateUser',
      createdAt: 300,
      score: 0,
      permalink: '',
      content: 'private severe violation',
      classification: classification('severe', 10),
      moderatedAt: 301,
    });

    expect(await store.user('PrivateUser')).toMatchObject({ points: -5, tier: 0, status: 'uncivil' });
    expect(await contribution(store, 'modmail:abc:m2')).toMatchObject({
      penaltyPoints: 10,
      removeRequired: false,
      banRequired: false,
      basePointsAwarded: 0,
    });
    expect((await store.pendingEffects(301_000)).removals).toEqual([]);
  });
});
