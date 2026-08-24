import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RedditRelationshipUser } from '../src/reddit/decode.ts';
import type { RedditFlairAssignment } from '../src/reddit/types.ts';
import { CommunityProjectionRuntime, type CommunityProjectionReader, type CommunityProjectionWriter } from '../src/reputation/communityProjectionRuntime.ts';
import { CommunityProjectionStore } from '../src/reputation/communityProjectionStore.ts';
import { REPUTATION_FLOOR } from '../src/reputation/policy.ts';
import { ReputationStore, type ReputationBootstrap } from '../src/reputation/store.ts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const relationship = (username: string): RedditRelationshipUser => ({
  username,
  note: null,
  date: null,
});

const bootstrap = (): ReputationBootstrap => ({
  subreddit: 'catgirlcoin',
  at: 100,
  userFlairTemplates: [],
  postFlairTemplates: [],
  flairReferences: {
    user: {
      mae: 'mae',
      lisa: 'lisa',
      kita: 'kita',
      aoi: 'aoi',
      hana: 'hana',
      rin: 'rin',
      celeste: 'celeste',
      pawsomeContributor: 'pawsome',
      warned: 'warned',
      uncivil: 'uncivil',
      scam: 'scam',
    },
    post: { minorAnnouncement: null, announcement: null },
  },
  users: [
    {
      username: 'BannedUser',
      points: REPUTATION_FLOOR,
      tier: 0,
      status: 'banned',
      currentFlairTemplateId: null,
      currentFlairText: null,
      currentFlairCssClass: null,
      desiredFlairTemplateId: null,
      desiredFlairText: null,
      immutableModeratorFlair: false,
      needsFlair: false,
      needsReview: false,
      source: 'reddit-ban',
      seededAt: 100,
    },
    {
      username: 'OrdinaryUser',
      points: 1,
      tier: 1,
      status: 'ordinary',
      currentFlairTemplateId: null,
      currentFlairText: null,
      currentFlairCssClass: null,
      desiredFlairTemplateId: null,
      desiredFlairText: null,
      immutableModeratorFlair: false,
      needsFlair: false,
      needsReview: false,
      source: 'recent-unflaired-contributor',
      seededAt: 100,
    },
  ],
  coverage: {
    flairAssignments: 0,
    moderators: 0,
    bannedUsers: 1,
    recentPostsScanned: 0,
    recentCommentsScanned: 0,
    recentContributorsWithoutFlair: 0,
    note: 'community projection runtime test',
  },
});

const catalogue = JSON.stringify({
  schema: 2,
  sourceSubreddit: 'catgirlcoin',
  targetSubreddit: 'nyaonearth',
  userTemplates: { source: [], target: [], mapping: [] },
  postTemplates: { source: [], target: [], mapping: [] },
});

class Reader implements CommunityProjectionReader {
  public bans: readonly RedditRelationshipUser[] = [];
  public mutes: readonly RedditRelationshipUser[] = [];
  public async userFlairAssignments(): Promise<readonly RedditFlairAssignment[]> { return []; }
  public async bannedUsers(): Promise<readonly RedditRelationshipUser[]> { return this.bans; }
  public async mutedUsers(): Promise<readonly RedditRelationshipUser[]> { return this.mutes; }
}

class Writer implements CommunityProjectionWriter {
  public readonly order: string[] = [];
  public failMute = false;
  public async setUserFlairTemplate(): Promise<void> {}
  public async muteUser(subreddit: string, username: string): Promise<void> {
    this.order.push(`mute:${subreddit}:${username}`);
    if (this.failMute) throw new Error('mute failed');
  }
  public async unmuteUser(subreddit: string, username: string): Promise<void> {
    this.order.push(`unmute:${subreddit}:${username}`);
  }
  public async banUser(subreddit: string, username: string): Promise<void> {
    this.order.push(`ban:${subreddit}:${username}`);
  }
}

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'mae-community-projection-'));
  roots.push(root);
  const reputation = new ReputationStore(join(root, 'reputation.pb'));
  await reputation.bootstrap(bootstrap());
  const projection = new CommunityProjectionStore(join(root, 'projection.pb'));
  const reader = new Reader();
  const writer = new Writer();
  const catalogueFile = join(root, 'flairs.json');
  const runtime = new CommunityProjectionRuntime(
    'catgirlcoin',
    'nyaonearth',
    catalogueFile,
    60_000,
    reader,
    writer,
    reputation,
    projection,
  );
  return { catalogueFile, projection, reader, reputation, runtime, writer };
};

describe('NyaOnEarth moderation projection', () => {
  test('pre-bootstrap startup establishes live permanent communication restriction before cloning bans', async () => {
    const f = await fixture();
    const first = await f.runtime.tick(1_000_000);
    expect(first.skipped).toBe(true);
    expect(first.failed).toBe(0);
    expect(f.writer.order).toEqual(['mute:nyaonearth:BannedUser']);

    // Reddit is the authority for whether the protection really exists. A
    // subsequent tick must observe the live relationship before exposing bans.
    f.reader.mutes = [relationship('BannedUser')];
    await writeFile(f.catalogueFile, catalogue);
    const second = await f.runtime.tick(1_000_001);
    expect(second.failed).toBe(0);
    expect(f.writer.order).toEqual([
      'mute:nyaonearth:BannedUser',
      'ban:nyaonearth:BannedUser',
    ]);
    expect(await f.projection.muteState('nyaonearth', 'BannedUser')).toEqual({
      redditMuted: true,
      appliedAt: 1_000_000,
    });
  });

  test('a failed attempt to establish a missing permanent mute blocks the corresponding target ban', async () => {
    const f = await fixture();
    await writeFile(f.catalogueFile, catalogue);
    f.writer.failMute = true;

    const result = await f.runtime.tick(2_000_000);
    expect(result.failed).toBe(1);
    expect(f.writer.order).toEqual(['mute:nyaonearth:BannedUser']);
    expect(await f.projection.muteState('nyaonearth', 'BannedUser')).toEqual({
      redditMuted: false,
      appliedAt: null,
    });
  });

  test('a stale Mae checkpoint is repaired when Reddit no longer reports the permanent mute', async () => {
    const f = await fixture();
    await f.projection.markMute('nyaonearth', 'BannedUser', 'mute', 1_000_000);

    const result = await f.runtime.tick(2_000_000);
    expect(result.failed).toBe(0);
    expect(f.writer.order).toEqual(['mute:nyaonearth:BannedUser']);
    expect(await f.projection.muteState('nyaonearth', 'BannedUser')).toEqual({
      redditMuted: true,
      appliedAt: 2_000_000,
    });
  });

  test('a live human mute not owned by Mae is never removed', async () => {
    const f = await fixture();
    f.reader.mutes = [relationship('OrdinaryUser')];

    const result = await f.runtime.tick(3_000_000);
    expect(result.failed).toBe(0);
    expect(f.writer.order).toEqual(['mute:nyaonearth:BannedUser']);
  });
});
