import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ModerationClassification,
  ModerationClassifier,
  ModerationItem,
} from '../src/mod/classifier.ts';
import {
  RedditModerationRuntime,
  type ModerationReader,
  type ModerationWriter,
} from '../src/mod/runtime.ts';
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
import { PAWSOME_FLAIR_TEXT, MODERATOR_POINTS } from '../src/reputation/policy.ts';
import { isMap } from '../src/types/json.ts';

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
    template('mod-id', 'Moderator:kitty-business:', 'm'),
  ],
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
    post: { minorAnnouncement: 'minor-id', announcement: 'announcement-id' },
  },
  users: [{
    username: 'HumanMod',
    points: MODERATOR_POINTS,
    tier: 9,
    status: 'moderator',
    currentFlairTemplateId: 'mod-id',
    currentFlairText: 'Moderator:kitty-business:',
    currentFlairCssClass: 'm',
    desiredFlairTemplateId: 'mod-id',
    desiredFlairText: 'Moderator:kitty-business:',
    immutableModeratorFlair: true,
    needsFlair: false,
    needsReview: false,
    source: 'moderator',
    seededAt: 100,
  }],
  coverage: {
    flairAssignments: 1,
    moderators: 1,
    bannedUsers: 0,
    recentPostsScanned: 0,
    recentCommentsScanned: 0,
    recentContributorsWithoutFlair: 0,
    note: 'runtime test',
  },
});

const post = (id: string, author: string, text: string, score = 1): RedditPost => ({
  id,
  fullname: `t3_${id}`,
  subreddit: 'catgirlcoin',
  title: text,
  author,
  permalink: `/r/catgirlcoin/comments/${id}/post/`,
  createdUtc: 200,
  selfText: text,
  url: '',
  flairTemplateId: null,
  flairText: null,
  stickied: false,
  locked: false,
  over18: false,
  crosspostParent: null,
  score,
  mediaUrls: [],
});

const comment = (
  id: string,
  author: string,
  body: string,
  score = 1,
  mediaUrls: readonly string[] = [],
): RedditComment => ({
  id,
  fullname: `t1_${id}`,
  subreddit: 'catgirlcoin',
  submissionFullname: 't3_parent',
  author,
  body,
  permalink: `/r/catgirlcoin/comments/parent/post/${id}/`,
  createdUtc: 201,
  distinguished: null,
  stickied: false,
  removedByCategory: null,
  score,
  mediaUrls,
});

const clean = (): ModerationClassification => ({
  verdict: 'clean',
  rule: 'none',
  disposition: 'allow',
  penaltyPoints: 0,
  confidence: 1,
  reason: 'clean',
  evidence: [],
});

const severe = (): ModerationClassification => ({
  verdict: 'severe',
  rule: 'rule_6',
  disposition: 'remove',
  penaltyPoints: 10,
  confidence: 1,
  reason: 'fud',
  evidence: ['doomposting'],
});

const scam = (): ModerationClassification => ({
  verdict: 'scam',
  rule: 'rule_5',
  disposition: 'remove',
  penaltyPoints: 999_999_999,
  confidence: 1,
  reason: 'promotion',
  evidence: ['malicious promotion'],
});

class FixtureClassifier implements ModerationClassifier {
  public readonly items: ModerationItem[] = [];
  public async classify(item: ModerationItem): Promise<ModerationClassification> {
    this.items.push(item);
    if (item.text.includes('SCAMMER')) return scam();
    if (item.text.includes('DEAD END')) return severe();
    return clean();
  }
}

class FixtureReader implements ModerationReader {
  public posts: readonly RedditPost[] = [];
  public comments: readonly RedditComment[] = [];
  public assignments: readonly RedditFlairAssignment[] = [{
    username: 'HumanMod', templateId: 'mod-id', text: 'Moderator:kitty-business:', cssClass: 'm',
  }];
  public scoreRows: readonly RedditThingScore[] = [];
  public moderatorCalls = 0;
  public async me(): Promise<RedditAccount> {
    return { id: 'mae-id', name: 'this_is_the_mae', createdUtc: 1, linkKarma: 0, commentKarma: 0 };
  }
  public async moderators(): Promise<readonly RedditModerator[]> {
    this.moderatorCalls += 1;
    return [{ name: 'HumanMod', id: 'mod-account', permissions: ['all'] }];
  }
  public async newPosts(): Promise<readonly RedditPost[]> { return this.posts; }
  public async newComments(): Promise<readonly RedditComment[]> { return this.comments; }
  public async userFlairAssignments(): Promise<readonly RedditFlairAssignment[]> { return this.assignments; }
  public async scores(fullnames: readonly string[]): Promise<readonly RedditThingScore[]> {
    const wanted = new Set(fullnames);
    return this.scoreRows.filter(value => wanted.has(value.fullname));
  }
}

class FixtureWriter implements ModerationWriter {
  public readonly flairs: { username: string; templateId: string }[] = [];
  public readonly removals: string[] = [];
  public readonly bans: string[] = [];
  public readonly notices: string[] = [];
  public readonly mutes: string[] = [];
  public readonly unmutes: string[] = [];
  public async setUserFlairTemplate(_subreddit: string, username: string, templateId: string): Promise<void> {
    this.flairs.push({ username, templateId });
  }
  public async remove(fullname: string): Promise<void> { this.removals.push(fullname); }
  public async banUser(_subreddit: string, username: string): Promise<void> { this.bans.push(username); }
  public async sendPrivateMessage(username: string): Promise<void> { this.notices.push(username); }
  public async muteUser(_subreddit: string, username: string): Promise<void> { this.mutes.push(username); }
  public async unmuteUser(_subreddit: string, username: string): Promise<void> { this.unmutes.push(username); }
}

const config = (stateFile: string): RedditModerationCfg => ({
  ai: { key: 'unused', model: 'unused', effort: 'low' },
  stateFile,
  batchSize: 100,
  scoreBatchSize: 100,
  flairReconcileMs: 1,
});

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'mae-moderation-runtime-'));
  roots.push(root);
  const file = join(root, 'reputation.pb');
  const reputation = new ReputationStore(file);
  await reputation.bootstrap(bootstrap());
  const reader = new FixtureReader();
  const writer = new FixtureWriter();
  const classifier = new FixtureClassifier();
  const runtime = new RedditModerationRuntime('catgirlcoin', config(file), reader, writer, reputation, classifier);
  return { reputation, reader, writer, classifier, runtime };
};

describe('live Reddit moderation runtime', () => {
  test('Mae and moderators are excluded before classifier and severe minus ten respects ban threshold', async () => {
    const f = await fixture();
    f.reader.posts = [post('mae', 'this_is_the_mae', 'Mae announcement'), post('mod', 'HumanMod', 'Moderator announcement')];
    f.reader.comments = [
      comment('clean', 'OrdinaryUser', 'Had no idea this was still alive tbh.'),
      comment('severe', 'FudUser', 'DEAD END new road map too', 1, ['https://preview.redd.it/dead-end.gif']),
      comment('scam', 'Scammer', 'SCAMMER buy my other token now'),
    ];

    const result = await f.runtime.tick();
    expect(result.discovered).toBe(5);
    expect(result.exempt).toBe(2);
    expect(result.audited).toBe(3);
    expect(result.failed).toBe(0);
    expect(f.classifier.items.map(item => item.author).sort()).toEqual(['FudUser', 'OrdinaryUser', 'Scammer']);
    expect(f.classifier.items.some(item => item.author === 'this_is_the_mae')).toBe(false);
    expect(f.classifier.items.some(item => item.author === 'HumanMod')).toBe(false);
    expect(f.classifier.items.find(item => item.author === 'FudUser')?.mediaUrls)
      .toEqual(['https://preview.redd.it/dead-end.gif']);

    expect(f.writer.removals.sort()).toEqual(['t1_scam', 't1_severe']);
    expect(f.writer.bans.sort()).toEqual(['FudUser', 'Scammer']);
    expect(f.writer.mutes.sort()).toEqual(['FudUser', 'Scammer']);
    expect(f.writer.notices.sort()).toEqual(['FudUser', 'Scammer']);
    expect(f.writer.flairs.some(value => value.username === 'OrdinaryUser')).toBe(true);
    expect(f.writer.flairs).toContainEqual({ username: 'Scammer', templateId: 'scam-id' });

    const raw = await f.reputation.raw();
    if (!isMap(raw) || !isMap(raw['users'])) throw new Error('runtime users missing');
    const ordinary = raw['users']['ordinaryuser'];
    if (!isMap(ordinary)) throw new Error('ordinary user missing');
    expect(ordinary['points']).toBe(1);
    expect(ordinary['tier']).toBe(1);
  });

  test('repeating same poll does not rerun LLM moderation or replay side effects', async () => {
    const f = await fixture();
    f.reader.comments = [comment('clean', 'OrdinaryUser', 'Catgirl is still a thing?')];
    await f.runtime.tick();
    const firstCalls = f.classifier.items.length;
    const firstFlairs = f.writer.flairs.length;
    await f.runtime.tick();
    expect(firstCalls).toBe(1);
    expect(f.classifier.items).toHaveLength(1);
    expect(f.writer.flairs).toHaveLength(firstFlairs);
    expect(f.writer.removals).toEqual([]);
    expect(f.writer.bans).toEqual([]);
    expect(f.reader.moderatorCalls).toBe(1);
  });

  test('manual member flair changes are restored from database while moderator flair is untouched', async () => {
    const f = await fixture();
    f.reader.comments = [comment('clean', 'OrdinaryUser', 'Useful contribution')];
    await f.runtime.tick();
    const canonical = f.writer.flairs.find(value => value.username === 'OrdinaryUser');
    if (canonical === undefined) throw new Error('OrdinaryUser did not receive a canonical flair');
    f.reader.comments = [];
    f.reader.assignments = [
      { username: 'OrdinaryUser', templateId: canonical.templateId === 'mae-id' ? 'kita-id' : 'mae-id', text: canonical.templateId === 'mae-id' ? ':kita:' : ':mae:', cssClass: 'h' },
      { username: 'HumanMod', templateId: 'mae-id', text: ':mae:', cssClass: 'h' },
    ];
    await new Promise(resolve => setTimeout(resolve, 2));
    const before = f.writer.flairs.length;
    const result = await f.runtime.tick();
    const restored = f.writer.flairs.slice(before);
    expect(result.flairRestored).toBe(1);
    expect(restored).toEqual([canonical]);
    expect(restored.some(value => value.username === 'HumanMod')).toBe(false);
  });
});
