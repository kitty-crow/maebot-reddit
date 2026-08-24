import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommunityModerationWriter } from '../src/mod/communityWriter.ts';
import type { ModerationClassification, ModerationClassifier, ModerationItem } from '../src/mod/classifier.ts';
import { RedditModerationRuntime, type ModerationReader, type ModerationWriter } from '../src/mod/runtime.ts';
import type { RedditModerationCfg } from '../src/env.ts';
import type {
  RedditAccount,
  RedditComment,
  RedditFlairAssignment,
  RedditFlairTemplate,
  RedditModerator,
  RedditPost,
  RedditThingScore,
} from '../src/reddit/types.ts';
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
    template('pawsome-id', 'Pawsome contributor :catgirl-moon:', 'h'),
    template('warned-id', ' ', 'w'),
    template('uncivil-id', ' ', 'u'),
    template('scam-id', 'SCAM', 's'),
  ],
  postFlairTemplates: [],
  flairReferences: {
    user: {
      mae: 'mae-id', lisa: 'lisa-id', kita: 'kita-id', aoi: 'aoi-id',
      hana: 'hana-id', rin: 'rin-id', celeste: 'celeste-id', pawsomeContributor: 'pawsome-id',
      warned: 'warned-id', uncivil: 'uncivil-id', scam: 'scam-id',
    },
    post: { minorAnnouncement: null, announcement: null },
  },
  users: [],
  coverage: {
    flairAssignments: 0,
    moderators: 0,
    bannedUsers: 0,
    recentPostsScanned: 0,
    recentCommentsScanned: 0,
    recentContributorsWithoutFlair: 0,
    note: 'multi-community test',
  },
});

const comment = (id: string, subreddit: string, author: string, body: string): RedditComment => ({
  id,
  fullname: `t1_${id}`,
  subreddit,
  submissionFullname: 't3_parent',
  author,
  body,
  permalink: `/r/${subreddit}/comments/parent/post/${id}/`,
  createdUtc: 200,
  distinguished: null,
  stickied: false,
  removedByCategory: null,
  score: 1,
  mediaUrls: [],
});

class Reader implements ModerationReader {
  public async me(): Promise<RedditAccount> {
    return { id: 'mae', name: 'this_is_the_mae', createdUtc: 1, linkKarma: 0, commentKarma: 0 };
  }
  public async moderators(subreddit: string): Promise<readonly RedditModerator[]> {
    return subreddit === 'nyaonearth'
      ? [{ name: 'TargetOnlyMod', id: 'mod', permissions: ['all'] }]
      : [];
  }
  public async newPosts(): Promise<readonly RedditPost[]> { return []; }
  public async newComments(subreddit: string): Promise<readonly RedditComment[]> {
    if (subreddit === 'catgirlcoin') return [comment('source', subreddit, 'SourceUser', 'clean')];
    return [
      comment('target-mod', subreddit, 'TargetOnlyMod', 'moderator text'),
      comment('target-scam', subreddit, 'ScamUser', 'SCAM'),
    ];
  }
  public async scores(): Promise<readonly RedditThingScore[]> { return []; }
  public async userFlairAssignments(): Promise<readonly RedditFlairAssignment[]> { return []; }
}

class Classifier implements ModerationClassifier {
  public readonly authors: string[] = [];
  public async classify(item: ModerationItem): Promise<ModerationClassification> {
    this.authors.push(item.author);
    const scam = item.text.includes('SCAM');
    return {
      verdict: scam ? 'scam' : 'clean',
      rule: scam ? 'rule_5' : 'none',
      disposition: scam ? 'remove' : 'allow',
      penaltyPoints: scam ? 999_999_999 : 0,
      confidence: 1,
      reason: scam ? 'scam fixture' : 'clean fixture',
      evidence: [],
    };
  }
}

class Writer implements ModerationWriter {
  public readonly bans: string[] = [];
  public readonly mutes: string[] = [];
  public async setUserFlairTemplate(): Promise<void> {}
  public async remove(): Promise<void> {}
  public async banUser(subreddit: string, username: string): Promise<void> {
    this.bans.push(`${subreddit}:${username}`);
  }
  public async sendPrivateMessage(): Promise<void> {}
  public async muteUser(subreddit: string, username: string): Promise<void> {
    this.mutes.push(`${subreddit}:${username}`);
  }
  public async unmuteUser(): Promise<void> {}
}

const config = (stateFile: string): RedditModerationCfg => ({
  ai: { key: 'unused', model: 'unused', effort: 'low' },
  stateFile,
  batchSize: 100,
  scoreBatchSize: 100,
  flairReconcileMs: 60_000,
});

describe('one moderation runtime across both communities', () => {
  test('audits both communities, respects local moderators, and enforces canonical bans/mutes on both', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mae-multicommunity-'));
    roots.push(root);
    const file = join(root, 'reputation.pb');
    const reputation = new ReputationStore(file);
    await reputation.bootstrap(bootstrap());
    const reader = new Reader();
    const baseWriter = new Writer();
    const writer = new CommunityModerationWriter(baseWriter, ['catgirlcoin', 'nyaonearth']);
    const classifier = new Classifier();
    const runtime = new RedditModerationRuntime(
      ['catgirlcoin', 'nyaonearth'],
      config(file),
      reader,
      writer,
      reputation,
      classifier,
    );

    const result = await runtime.tick();
    expect(result.discovered).toBe(3);
    expect(result.audited).toBe(2);
    expect(result.exempt).toBe(1);
    expect(classifier.authors.sort()).toEqual(['ScamUser', 'SourceUser']);
    expect(baseWriter.bans.sort()).toEqual(['catgirlcoin:ScamUser', 'nyaonearth:ScamUser']);
    expect(baseWriter.mutes.sort()).toEqual(['catgirlcoin:ScamUser', 'nyaonearth:ScamUser']);
    expect(await reputation.user('ScamUser')).toMatchObject({ status: 'scam', points: -999_999_999 });
  });
});
