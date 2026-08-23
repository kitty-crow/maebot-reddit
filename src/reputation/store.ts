import type { RedditFlairTemplate } from '../reddit/types.ts';
import { isMap, type Json, type JsonMap } from '../types/json.ts';
import { Store } from '../store/store.ts';
import type { ReputationStatus, ReputationTier } from './policy.ts';

export type ReputationSeedSource =
  | 'tier-flair'
  | 'status-flair'
  | 'reddit-ban'
  | 'recent-unflaired-contributor'
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

export class ReputationStore {
  private readonly store: Store;

  public constructor(file = 'data/reputation.pb') {
    this.store = new Store(file, initial());
  }

  public async hasBootstrap(): Promise<boolean> {
    const value = await this.store.read();
    return isMap(value) && value['schema'] === 1 && typeof value['bootstrappedAt'] === 'number' && value['bootstrappedAt'] > 0;
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

  public async raw(): Promise<Json> {
    return await this.store.read();
  }
}
