import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RedditFlairTemplate } from '../src/reddit/types.ts';
import { isMap } from '../src/types/json.ts';
import { ReputationStore, type ReputationBootstrap } from '../src/reputation/store.ts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const template = (id: string, text: string): RedditFlairTemplate => ({
  id,
  text,
  cssClass: null,
  textColour: 'dark',
  backgroundColour: null,
  modOnly: false,
  textEditable: false,
  allowableContent: 'all',
  maxEmojis: 1,
});

test('bootstrap writes one durable protobuf-backed reputation snapshot and refuses accidental reseeding', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mae-reputation-'));
  roots.push(root);
  const file = join(root, 'reputation.pb');
  const store = new ReputationStore(file);
  const bootstrap: ReputationBootstrap = {
    subreddit: 'catgirlcoin',
    at: 123,
    userFlairTemplates: [template('mae-id', ':mae:')],
    postFlairTemplates: [template('minor-id', 'Minor Announcement :lisa:')],
    flairReferences: {
      user: {
        mae: 'mae-id',
        lisa: 'lisa-id',
        kita: 'kita-id',
        aoi: 'aoi-id',
        hana: 'hana-id',
        rin: 'rin-id',
        celeste: 'celeste-id',
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
      currentFlairCssClass: null,
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
  };

  await store.bootstrap(bootstrap);
  expect(await store.hasBootstrap()).toBe(true);

  const reopened = new ReputationStore(file);
  const raw = await reopened.raw();
  expect(isMap(raw)).toBe(true);
  if (!isMap(raw)) throw new Error('reputation snapshot was not a map');
  expect(raw['subreddit']).toBe('catgirlcoin');
  expect(raw['bootstrappedAt']).toBe(123);
  const users = raw['users'];
  expect(isMap(users)).toBe(true);
  if (!isMap(users)) throw new Error('reputation users were not a map');
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

  await expect(reopened.bootstrap(bootstrap)).rejects.toThrow('already bootstrapped');
});
