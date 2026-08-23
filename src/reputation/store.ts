import { createHash } from 'node:crypto';
import type { ModerationClassification } from '../mod/classifier.ts';
import type { RedditFlairTemplate } from '../reddit/types.ts';
import { Store } from '../store/store.ts';
import { isMap, type Json, type JsonMap } from '../types/json.ts';
import {
  chooseFlairForTier,
  type OrdinaryTier,
  type ReputationStatus,
  type ReputationTier,
} from './policy.ts';
import {
  applyContributionPolicy,
  applyPositiveCredits,
} from './runtimePolicy.ts';

export type ReputationSeedSource =
  | 'tier-flair'
  | 'status-flair'
  | 'reddit-ban'
  | 'recent-unflaired-contributor'
  | 'live-contribution'
  | 'moderator'
  | 'unmapped-flair';

export type ReputationUser = {
  readonly username: string;
  readonly points: number;
  readonly tier: ReputationTier;
  readonly status: ReputationStatus;
  readonly currentFlairTemplateId: string | null;
  readonly currentFlairText: string | null;
  readonly currentFlairCssClass: string | null;
  readonly desiredFlairTemplateId: string | null;
  readonly desiredFlairText: string | null;
  readonly immutableModeratorFlair: boolean;
  readonly needsFlair: boolean;
  readonly needsReview: boolean;
  readonly source: ReputationSeedSource;
  readonly seededAt: number;
};

export type ReputationFlairReferences = {
  readonly user: {
    readonly mae: string;
    readonly lisa: string;
    readonly kita: string;
    readonly aoi: string;
    readonly hana: string;
    readonly rin: string;
    readonly celeste: string;
    readonly pawsomeContributor: string;
    readonly warned: string | null;
    readonly uncivil: string | null;
    readonly scam: string | null;
  };
  readonly post: {
    readonly minorAnnouncement: string | null;
    readonly announcement: string | null;
  };
};

export type ReputationBootstrapCoverage = {
  readonly flairAssignments: number;
  readonly moderators: number;
  readonly bannedUsers: number;
  readonly recentPostsScanned: number;
  readonly recentCommentsScanned: number;
  readonly recentContributorsWithoutFlair: number;
  readonly note: string;
};

export type ReputationBootstrap = {
  readonly subreddit: string;
  readonly at: number;
  readonly userFlairTemplates: readonly RedditFlairTemplate[];
  readonly postFlairTemplates: readonly RedditFlairTemplate[];
  readonly flairReferences: ReputationFlairReferences;
  readonly users: readonly ReputationUser[];
  readonly coverage: ReputationBootstrapCoverage;
};

export type ReputationContributionKind = 'post' | 'comment';

export type ReputationContributionInput = {
  readonly fullname: string;
  readonly kind: ReputationContributionKind;
  readonly author: string;
  readonly createdAt: number;
  readonly score: number;
  readonly classification: ModerationClassification;
  readonly moderatedAt: number;
};

export type ReputationPendingFlair = {
  readonly username: string;
  readonly templateId: string;
  readonly text: string;
};

export type ReputationPendingRemoval = {
  readonly fullname: string;
};

export type ReputationPendingBan = {
  readonly fullname: string;
  readonly username: string;
};

export type ReputationPendingEffects = {
  readonly flairs: readonly ReputationPendingFlair[];
  readonly removals: readonly ReputationPendingRemoval[];
  readonly bans: readonly ReputationPendingBan[];
};

const initial = (): JsonMap => ({
  schema: 1,
  subreddit: '',
  bootstrappedAt: 0,
  flairCatalog: { user: [], post: [] },
  flairReferences: { user: {}, post: {} },
  users: {},
  contributions: {},
  reputationJournal: {},
  coverage: {},
});

const templateJson = (value: RedditFlairTemplate): JsonMap => ({
  id: value.id,
  text: value.text,
  cssClass: value.cssClass,
  textColour: value.textColour,
  backgroundColour: value.backgroundColour,
  modOnly: value.modOnly,
  textEditable: value.textEditable,
  allowableContent: value.allowableContent,
  maxEmojis: value.maxEmojis,
});

const userJson = (value: ReputationUser): JsonMap => ({
  username: value.username,
  points: value.points,
  tier: value.tier,
  status: value.status,
  currentFlairTemplateId: value.currentFlairTemplateId,
  currentFlairText: value.currentFlairText,
  currentFlairCssClass: value.currentFlairCssClass,
  desiredFlairTemplateId: value.desiredFlairTemplateId,
  desiredFlairText: value.desiredFlairText,
  immutableModeratorFlair: value.immutableModeratorFlair,
  needsFlair: value.needsFlair,
  needsReview: value.needsReview,
  source: value.source,
  seededAt: value.seededAt,
});

const referencesJson = (value: ReputationFlairReferences): JsonMap => ({
  user: {
    mae: value.user.mae,
    lisa: value.user.lisa,
    kita: value.user.kita,
    aoi: value.user.aoi,
    hana: value.user.hana,
    rin: value.user.rin,
    celeste: value.user.celeste,
    pawsomeContributor: value.user.pawsomeContributor,
    warned: value.user.warned,
    uncivil: value.user.uncivil,
    scam: value.user.scam,
  },
  post: {
    minorAnnouncement: value.post.minorAnnouncement,
    announcement: value.post.announcement,
  },
});

const coverageJson = (value: ReputationBootstrapCoverage): JsonMap => ({
  flairAssignments: value.flairAssignments,
  moderators: value.moderators,
  bannedUsers: value.bannedUsers,
  recentPostsScanned: value.recentPostsScanned,
  recentCommentsScanned: value.recentCommentsScanned,
  recentContributorsWithoutFlair: value.recentContributorsWithoutFlair,
  note: value.note,
});

const root = (value: Json): JsonMap => {
  if (!isMap(value) || value['schema'] !== 1) throw new Error('Unsupported reputation store');
  if (!isMap(value['users'])) value['users'] = {};
  if (!isMap(value['contributions'])) value['contributions'] = {};
  if (!isMap(value['reputationJournal'])) value['reputationJournal'] = {};
  return value;
};

const mapField = (value: JsonMap, name: string): JsonMap => {
  const field = value[name];
  if (!isMap(field)) throw new Error(`Reputation ${name} map is invalid`);
  return field;
};

const textOrNull = (value: Json | undefined): string | null =>
  typeof value === 'string' ? value : null;

const bool = (value: Json | undefined): boolean => value === true;

const integer = (value: Json | undefined, fallback = 0): number =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback;

const tier = (value: Json | undefined): ReputationTier =>
  value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 9
    ? value
    : 0;

const status = (value: Json | undefined): ReputationStatus => {
  if (
    value === 'ordinary'
    || value === 'warned'
    || value === 'uncivil'
    || value === 'banned'
    || value === 'scam'
    || value === 'moderator'
    || value === 'unmapped'
  ) return value;
  return 'unmapped';
};

const source = (value: Json | undefined): ReputationSeedSource => {
  if (
    value === 'tier-flair'
    || value === 'status-flair'
    || value === 'reddit-ban'
    || value === 'recent-unflaired-contributor'
    || value === 'live-contribution'
    || value === 'moderator'
    || value === 'unmapped-flair'
  ) return value;
  return 'live-contribution';
};

const userFrom = (value: Json | undefined): ReputationUser | null => {
  if (!isMap(value) || typeof value['username'] !== 'string') return null;
  return {
    username: value['username'],
    points: integer(value['points']),
    tier: tier(value['tier']),
    status: status(value['status']),
    currentFlairTemplateId: textOrNull(value['currentFlairTemplateId']),
    currentFlairText: textOrNull(value['currentFlairText']),
    currentFlairCssClass: textOrNull(value['currentFlairCssClass']),
    desiredFlairTemplateId: textOrNull(value['desiredFlairTemplateId']),
    desiredFlairText: textOrNull(value['desiredFlairText']),
    immutableModeratorFlair: bool(value['immutableModeratorFlair']),
    needsFlair: bool(value['needsFlair']),
    needsReview: bool(value['needsReview']),
    source: source(value['source']),
    seededAt: integer(value['seededAt']),
  };
};

const blankUser = (username: string, at: number): ReputationUser => ({
  username,
  points: 0,
  tier: 0,
  status: 'ordinary',
  currentFlairTemplateId: null,
  currentFlairText: null,
  currentFlairCssClass: null,
  desiredFlairTemplateId: null,
  desiredFlairText: null,
  immutableModeratorFlair: false,
  needsFlair: false,
  needsReview: false,
  source: 'live-contribution',
  seededAt: at,
});

const refText = (value: Json | undefined, name: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing reputation flair reference ${name}`);
  }
  return value;
};

const referencesFrom = (value: JsonMap): ReputationFlairReferences => {
  const refs = mapField(value, 'flairReferences');
  const user = mapField(refs, 'user');
  const post = mapField(refs, 'post');
  return {
    user: {
      mae: refText(user['mae'], 'mae'),
      lisa: refText(user['lisa'], 'lisa'),
      kita: refText(user['kita'], 'kita'),
      aoi: refText(user['aoi'], 'aoi'),
      hana: refText(user['hana'], 'hana'),
      rin: refText(user['rin'], 'rin'),
      celeste: refText(user['celeste'], 'celeste'),
      pawsomeContributor: refText(user['pawsomeContributor'], 'pawsomeContributor'),
      warned: textOrNull(user['warned']),
      uncivil: textOrNull(user['uncivil']),
      scam: textOrNull(user['scam']),
    },
    post: {
      minorAnnouncement: textOrNull(post['minorAnnouncement']),
      announcement: textOrNull(post['announcement']),
    },
  };
};

const catalogueField = (
  value: JsonMap,
  templateId: string,
  field: 'text' | 'cssClass',
): string | null => {
  const catalog = mapField(value, 'flairCatalog');
  const users = catalog['user'];
  if (!Array.isArray(users)) throw new Error('Reputation user flair catalog is invalid');
  for (const item of users) {
    if (!isMap(item) || item['id'] !== templateId) continue;
    const selected = item[field];
    if (selected === null) return null;
    if (typeof selected === 'string') return selected;
    throw new Error(`Flair template ${templateId} has an invalid ${field}`);
  }
  throw new Error(`Flair template ${templateId} is missing from the reputation catalog`);
};

const catalogueText = (value: JsonMap, templateId: string): string => {
  const text = catalogueField(value, templateId, 'text');
  if (text === null) throw new Error(`Flair template ${templateId} has no text`);
  return text;
};

const stableRoll = (username: string, targetTier: OrdinaryTier, eventKey: string): number => {
  const digest = createHash('sha256')
    .update('mae-runtime-tier-entry\0')
    .update(username.trim().toLowerCase())
    .update('\0')
    .update(String(targetTier))
    .update('\0')
    .update(eventKey)
    .digest();
  return digest.readUIntBE(0, 6) / 281_474_976_710_656;
};

const ordinaryFlair = (
  refs: ReputationFlairReferences,
  username: string,
  targetTier: OrdinaryTier,
  eventKey: string,
): { readonly id: string; readonly text: string } => {
  const text = chooseFlairForTier(targetTier, () => stableRoll(username, targetTier, eventKey));
  if (text === ':mae:') return { id: refs.user.mae, text };
  if (text === ':lisa:') return { id: refs.user.lisa, text };
  if (text === ':kita:') return { id: refs.user.kita, text };
  if (text === ':aoi:') return { id: refs.user.aoi, text };
  if (text === ':hana:') return { id: refs.user.hana, text };
  if (text === ':rin:') return { id: refs.user.rin, text };
  if (text === ':celeste:') return { id: refs.user.celeste, text };
  return { id: refs.user.pawsomeContributor, text };
};

const desiredFor = (
  value: JsonMap,
  previous: ReputationUser,
  nextPoints: number,
  nextTier: ReputationTier,
  nextStatus: ReputationStatus,
  eventKey: string,
): { readonly id: string | null; readonly text: string | null } => {
  const refs = referencesFrom(value);

  if (nextStatus === 'warned') {
    if (refs.user.warned === null) throw new Error('Warned flair reference is unavailable');
    return { id: refs.user.warned, text: catalogueText(value, refs.user.warned) };
  }
  if (nextStatus === 'uncivil') {
    if (refs.user.uncivil === null) throw new Error('Uncivil flair reference is unavailable');
    return { id: refs.user.uncivil, text: catalogueText(value, refs.user.uncivil) };
  }
  if (nextStatus === 'scam') {
    if (refs.user.scam === null) throw new Error('SCAM flair reference is unavailable');
    return { id: refs.user.scam, text: catalogueText(value, refs.user.scam) };
  }
  if (nextStatus === 'banned' || nextStatus === 'moderator') {
    return { id: previous.currentFlairTemplateId, text: previous.currentFlairText };
  }
  if (nextTier === 0 || nextPoints <= 0) {
    return { id: previous.currentFlairTemplateId, text: previous.currentFlairText };
  }
  if (nextTier === previous.tier && previous.desiredFlairTemplateId !== null) {
    return { id: previous.desiredFlairTemplateId, text: previous.desiredFlairText };
  }
  return ordinaryFlair(refs, previous.username, nextTier, eventKey);
};

const contributionJson = (
  input: ReputationContributionInput,
  remove: boolean,
  ban: boolean,
): JsonMap => ({
  fullname: input.fullname,
  kind: input.kind,
  author: input.author,
  createdAt: input.createdAt,
  moderatedAt: input.moderatedAt,
  exempt: false,
  verdict: input.classification.verdict,
  rule: input.classification.rule,
  disposition: input.classification.disposition,
  confidence: input.classification.confidence,
  reason: input.classification.reason,
  evidence: [...input.classification.evidence],
  creditedScore: input.score,
  pendingHigh: input.score,
  pendingSeen: 0,
  removeRequired: remove,
  removeApplied: false,
  banRequired: ban,
  banApplied: false,
});

const exemptContributionJson = (
  fullname: string,
  kind: ReputationContributionKind,
  author: string,
  createdAt: number,
  score: number,
  at: number,
): JsonMap => ({
  fullname,
  kind,
  author,
  createdAt,
  moderatedAt: at,
  exempt: true,
  verdict: 'clean',
  rule: 'none',
  disposition: 'allow',
  confidence: 1,
  reason: 'Privileged author is exempt from LLM moderation and reputation changes.',
  evidence: [],
  creditedScore: score,
  pendingHigh: score,
  pendingSeen: 0,
  removeRequired: false,
  removeApplied: true,
  banRequired: false,
  banApplied: true,
});

const journal = (value: JsonMap, key: string, body: JsonMap): void => {
  const entries = mapField(value, 'reputationJournal');
  if (entries[key] === undefined) entries[key] = body;
};

const scoreEligibleStatus = (value: ReputationStatus): boolean =>
  value === 'ordinary' || value === 'warned' || value === 'uncivil';

export class ReputationStore {
  private readonly store: Store;

  public constructor(file = 'data/reputation.pb') {
    this.store = new Store(file, initial());
  }

  public async hasBootstrap(): Promise<boolean> {
    const value = await this.store.read();
    return isMap(value)
      && value['schema'] === 1
      && typeof value['bootstrappedAt'] === 'number'
      && value['bootstrappedAt'] > 0;
  }

  public async bootstrap(value: ReputationBootstrap, force = false): Promise<void> {
    await this.store.edit(current => {
      if (!isMap(current) || current['schema'] !== 1) throw new Error('Unsupported reputation store');
      const existingAt = current['bootstrappedAt'];
      if (!force && typeof existingAt === 'number' && existingAt > 0) {
        throw new Error('Reputation store is already bootstrapped; pass --force only after reviewing the previous report');
      }
      const users: JsonMap = {};
      for (const user of value.users) users[user.username.toLowerCase()] = userJson(user);
      return {
        schema: 1,
        subreddit: value.subreddit,
        bootstrappedAt: value.at,
        flairCatalog: {
          user: value.userFlairTemplates.map(templateJson),
          post: value.postFlairTemplates.map(templateJson),
        },
        flairReferences: referencesJson(value.flairReferences),
        users,
        contributions: {},
        reputationJournal: {},
        coverage: coverageJson(value.coverage),
      } satisfies JsonMap;
    });
  }

  public async hasContribution(fullname: string): Promise<boolean> {
    const value = root(await this.store.read());
    return mapField(value, 'contributions')[fullname] !== undefined;
  }

  public async recordExempt(
    fullname: string,
    kind: ReputationContributionKind,
    author: string,
    createdAt: number,
    score: number,
    at: number,
  ): Promise<void> {
    await this.store.edit(current => {
      const value = root(current);
      const contributions = mapField(value, 'contributions');
      if (contributions[fullname] === undefined) {
        contributions[fullname] = exemptContributionJson(fullname, kind, author, createdAt, score, at);
      }
      return value;
    });
  }

  public async applyModeration(input: ReputationContributionInput): Promise<ReputationUser> {
    let output: ReputationUser | null = null;
    await this.store.edit(current => {
      const value = root(current);
      const contributions = mapField(value, 'contributions');
      const users = mapField(value, 'users');
      const key = input.author.trim().toLowerCase();
      const existingContribution = contributions[input.fullname];
      if (existingContribution !== undefined) {
        const existingUser = userFrom(users[key]);
        if (existingUser === null) {
          throw new Error(`Contribution ${input.fullname} exists without user ${input.author}`);
        }
        output = existingUser;
        return value;
      }

      const previous = userFrom(users[key]) ?? blankUser(input.author, input.moderatedAt);
      if (previous.status === 'moderator' || previous.immutableModeratorFlair) {
        throw new Error(`Moderator u/${input.author} reached reputation mutation boundary`);
      }

      const transition = applyContributionPolicy(previous, input.kind, input.classification);
      const desired = desiredFor(
        value,
        previous,
        transition.points,
        transition.tier,
        transition.status,
        input.fullname,
      );
      const next: ReputationUser = {
        ...previous,
        points: transition.points,
        tier: transition.tier,
        status: transition.status,
        desiredFlairTemplateId: desired.id,
        desiredFlairText: desired.text,
        needsFlair: desired.id !== null && desired.id !== previous.currentFlairTemplateId,
        needsReview: false,
        source: previous.source === 'unmapped-flair' ? 'live-contribution' : previous.source,
      };

      users[key] = userJson(next);
      contributions[input.fullname] = contributionJson(input, transition.remove, transition.ban);
      journal(value, `moderation:${input.fullname}`, {
        kind: 'moderation',
        fullname: input.fullname,
        username: input.author,
        at: input.moderatedAt,
        verdict: input.classification.verdict,
        rule: input.classification.rule,
        contentKind: input.kind,
        beforePoints: previous.points,
        afterPoints: next.points,
        beforeStatus: previous.status,
        afterStatus: next.status,
        remove: transition.remove,
        ban: transition.ban,
      });
      output = next;
      return value;
    });

    if (output === null) throw new Error('Reputation moderation transaction produced no user');
    return output;
  }

  public async observeScore(fullname: string, score: number, at: number): Promise<number> {
    if (!Number.isSafeInteger(score)) throw new Error('Reddit score must be a safe integer');
    let awarded = 0;

    await this.store.edit(current => {
      const value = root(current);
      const contributions = mapField(value, 'contributions');
      const contribution = contributions[fullname];
      if (!isMap(contribution) || bool(contribution['exempt'])) return value;
      if (contribution['verdict'] !== 'clean') return value;

      const author = textOrNull(contribution['author']);
      if (author === null) return value;
      const users = mapField(value, 'users');
      const userKey = author.toLowerCase();
      const previous = userFrom(users[userKey]);
      if (previous === null || !scoreEligibleStatus(previous.status)) return value;

      const creditedScore = integer(contribution['creditedScore'], score);
      let pendingHigh = integer(contribution['pendingHigh'], creditedScore);
      let pendingSeen = integer(contribution['pendingSeen']);

      if (score <= creditedScore) {
        contribution['pendingHigh'] = creditedScore;
        contribution['pendingSeen'] = 0;
        return value;
      }

      if (pendingSeen === 0 || score < pendingHigh) {
        pendingHigh = score;
        pendingSeen = 1;
      } else {
        pendingSeen += 1;
      }

      contribution['pendingHigh'] = pendingHigh;
      contribution['pendingSeen'] = pendingSeen;
      if (pendingSeen < 2) return value;

      const redditDelta = pendingHigh - creditedScore;
      const transition = applyPositiveCredits(previous, redditDelta);
      awarded = Math.max(0, transition.points - previous.points);
      const desired = desiredFor(
        value,
        previous,
        transition.points,
        transition.tier,
        transition.status,
        `score:${fullname}:${pendingHigh}`,
      );
      const next: ReputationUser = {
        ...previous,
        points: transition.points,
        tier: transition.tier,
        status: transition.status,
        desiredFlairTemplateId: desired.id,
        desiredFlairText: desired.text,
        needsFlair: desired.id !== null && desired.id !== previous.currentFlairTemplateId,
      };

      users[userKey] = userJson(next);
      contribution['creditedScore'] = pendingHigh;
      contribution['pendingHigh'] = pendingHigh;
      contribution['pendingSeen'] = 0;
      journal(value, `score:${fullname}:${pendingHigh}`, {
        kind: 'score-high-water',
        fullname,
        username: author,
        at,
        redditScore: pendingHigh,
        redditDelta,
        pointsAwarded: awarded,
        beforePoints: previous.points,
        afterPoints: next.points,
        beforeStatus: previous.status,
        afterStatus: next.status,
      });
      return value;
    });

    return awarded;
  }

  public async pendingEffects(): Promise<ReputationPendingEffects> {
    const value = root(await this.store.read());
    const users = mapField(value, 'users');
    const contributions = mapField(value, 'contributions');
    const flairs: ReputationPendingFlair[] = [];
    const removals: ReputationPendingRemoval[] = [];
    const bans: ReputationPendingBan[] = [];

    for (const raw of Object.values(users)) {
      const user = userFrom(raw);
      if (
        user === null
        || !user.needsFlair
        || user.desiredFlairTemplateId === null
        || user.desiredFlairText === null
      ) continue;
      if (user.status === 'moderator' || user.immutableModeratorFlair) continue;
      flairs.push({
        username: user.username,
        templateId: user.desiredFlairTemplateId,
        text: user.desiredFlairText,
      });
    }

    for (const raw of Object.values(contributions)) {
      if (!isMap(raw) || bool(raw['exempt'])) continue;
      const contributionFullname = textOrNull(raw['fullname']);
      const author = textOrNull(raw['author']);
      if (contributionFullname === null || author === null) continue;
      if (bool(raw['removeRequired']) && !bool(raw['removeApplied'])) {
        removals.push({ fullname: contributionFullname });
      }
      if (bool(raw['banRequired']) && !bool(raw['banApplied'])) {
        bans.push({ fullname: contributionFullname, username: author });
      }
    }

    return { flairs, removals, bans };
  }

  public async markFlairApplied(
    username: string,
    templateId: string,
    text: string,
  ): Promise<void> {
    await this.store.edit(current => {
      const value = root(current);
      const users = mapField(value, 'users');
      const key = username.toLowerCase();
      const previous = userFrom(users[key]);
      if (previous === null || previous.desiredFlairTemplateId !== templateId) return value;
      users[key] = userJson({
        ...previous,
        currentFlairTemplateId: templateId,
        currentFlairText: text,
        currentFlairCssClass: catalogueField(value, templateId, 'cssClass'),
        desiredFlairTemplateId: templateId,
        desiredFlairText: text,
        needsFlair: false,
      });
      return value;
    });
  }

  public async markRemovalApplied(fullname: string): Promise<void> {
    await this.markContributionEffect(fullname, 'removeApplied');
  }

  public async markBanApplied(fullname: string): Promise<void> {
    await this.markContributionEffect(fullname, 'banApplied');
  }

  private async markContributionEffect(
    fullname: string,
    field: 'removeApplied' | 'banApplied',
  ): Promise<void> {
    await this.store.edit(current => {
      const value = root(current);
      const contributions = mapField(value, 'contributions');
      const contribution = contributions[fullname];
      if (isMap(contribution)) contribution[field] = true;
      return value;
    });
  }

  public async raw(): Promise<Json> {
    return await this.store.read();
  }
}
