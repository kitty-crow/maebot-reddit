import { isMap, type Json, type JsonMap } from '../types/json.ts';
import { Store } from '../store/store.ts';

export type ModerationReviewPlatform = 'telegram' | 'discord';
export type ModerationReviewChoice = 'approve' | 'reject';
export type ModerationTargetKind = 'comment' | 'submission' | 'user';
export type ModerationActionKind =
  | 'remove'
  | 'approve'
  | 'lock'
  | 'warn'
  | 'restrict'
  | 'ban'
  | 'unrestrict'
  | 'unban'
  | 'flair'
  | 'none';

export type ModerationReviewDecision = {
  readonly choice: ModerationReviewChoice;
  readonly platform: ModerationReviewPlatform;
  readonly userId: string;
  readonly userName: string;
  readonly at: number;
};

export type ModerationReviewCase = {
  readonly key: string;
  readonly targetKind: ModerationTargetKind;
  readonly targetId: string;
  readonly subreddit: string;
  readonly permalink: string;
  readonly author: string;
  readonly summary: string;
  readonly evidence: readonly string[];
  readonly recommendedAction: ModerationActionKind;
  readonly reason: string;
  readonly policy: string;
  readonly createdAt: number;
  readonly decision: ModerationReviewDecision | null;
  readonly appliedActionKey: string | null;
  readonly appliedAt: number | null;
  readonly lastError: string | null;
};

export type ModerationReviewInput = Omit<ModerationReviewCase,
  'decision' | 'appliedActionKey' | 'appliedAt' | 'lastError'>;

export type ModerationReviewClaim = {
  readonly won: boolean;
  readonly review: ModerationReviewCase;
};

const initial = (): JsonMap => ({ schema: 1, reviews: {} });
const text = (value: Json | undefined): string => typeof value === 'string' ? value : '';
const num = (value: Json | undefined): number => typeof value === 'number' && Number.isFinite(value) ? value : 0;

const root = (value: Json): JsonMap => {
  if (!isMap(value) || value['schema'] !== 1) throw new Error('Unsupported moderation review store');
  if (!isMap(value['reviews'])) value['reviews'] = {};
  return value;
};

const decision = (value: Json | undefined): ModerationReviewDecision | null => {
  if (!isMap(value)) return null;
  const choice = value['choice'];
  const platform = value['platform'];
  const userId = text(value['userId']);
  if ((choice !== 'approve' && choice !== 'reject') || (platform !== 'telegram' && platform !== 'discord') || userId.length === 0) return null;
  return {
    choice,
    platform,
    userId,
    userName: text(value['userName']),
    at: Math.max(0, Math.floor(num(value['at']))),
  };
};

const review = (value: Json | undefined): ModerationReviewCase | null => {
  if (!isMap(value)) return null;
  const targetKind = value['targetKind'];
  const recommendedAction = value['recommendedAction'];
  if (targetKind !== 'comment' && targetKind !== 'submission' && targetKind !== 'user') return null;
  if (
    recommendedAction !== 'remove' && recommendedAction !== 'approve' && recommendedAction !== 'lock'
    && recommendedAction !== 'warn' && recommendedAction !== 'restrict' && recommendedAction !== 'ban'
    && recommendedAction !== 'unrestrict' && recommendedAction !== 'unban' && recommendedAction !== 'flair'
    && recommendedAction !== 'none'
  ) return null;
  const key = text(value['key']);
  const targetId = text(value['targetId']);
  const subreddit = text(value['subreddit']);
  if (key.length === 0 || targetId.length === 0 || subreddit.length === 0) return null;
  const evidence = Array.isArray(value['evidence'])
    ? value['evidence'].filter((item): item is string => typeof item === 'string').slice(0, 20)
    : [];
  const appliedActionKey = text(value['appliedActionKey']);
  const lastError = text(value['lastError']);
  return {
    key,
    targetKind,
    targetId,
    subreddit,
    permalink: text(value['permalink']),
    author: text(value['author']),
    summary: text(value['summary']),
    evidence,
    recommendedAction,
    reason: text(value['reason']),
    policy: text(value['policy']),
    createdAt: Math.max(0, Math.floor(num(value['createdAt']))),
    decision: decision(value['decision']),
    appliedActionKey: appliedActionKey.length === 0 ? null : appliedActionKey,
    appliedAt: value['appliedAt'] === null || value['appliedAt'] === undefined ? null : Math.max(0, Math.floor(num(value['appliedAt']))),
    lastError: lastError.length === 0 ? null : lastError,
  };
};

const toJson = (value: ModerationReviewCase): JsonMap => ({
  key: value.key,
  targetKind: value.targetKind,
  targetId: value.targetId,
  subreddit: value.subreddit,
  permalink: value.permalink,
  author: value.author,
  summary: value.summary,
  evidence: [...value.evidence],
  recommendedAction: value.recommendedAction,
  reason: value.reason,
  policy: value.policy,
  createdAt: value.createdAt,
  decision: value.decision === null ? null : {
    choice: value.decision.choice,
    platform: value.decision.platform,
    userId: value.decision.userId,
    userName: value.decision.userName,
    at: value.decision.at,
  },
  appliedActionKey: value.appliedActionKey ?? '',
  appliedAt: value.appliedAt,
  lastError: value.lastError ?? '',
});

const map = (value: JsonMap): JsonMap => {
  const reviews = value['reviews'];
  if (!isMap(reviews)) throw new Error('Moderation review map is invalid');
  return reviews;
};

const validateInput = (input: ModerationReviewInput): void => {
  if (input.key.trim().length === 0) throw new Error('Moderation review key is required');
  if (input.targetId.trim().length === 0) throw new Error('Moderation review target ID is required');
  if (input.subreddit.trim().length === 0) throw new Error('Moderation review subreddit is required');
  if (input.policy.trim().length === 0) throw new Error('Moderation review policy revision is required');
  if (input.evidence.length > 20) throw new Error('Moderation review evidence is limited to 20 entries');
};

export class ModerationReviewStore {
  private readonly store: Store;

  public constructor(file = 'data/moderationReviews.pb') {
    this.store = new Store(file, initial());
  }

  public async get(key: string): Promise<ModerationReviewCase | null> {
    const value = root(await this.store.read());
    return review(map(value)[key]);
  }

  public async create(input: ModerationReviewInput): Promise<ModerationReviewCase> {
    validateInput(input);
    let out: ModerationReviewCase | null = null;
    await this.store.edit(current => {
      const value = root(current);
      const reviews = map(value);
      const existing = review(reviews[input.key]);
      if (existing !== null) {
        out = existing;
        return value;
      }
      const next: ModerationReviewCase = {
        ...input,
        evidence: [...input.evidence],
        decision: null,
        appliedActionKey: null,
        appliedAt: null,
        lastError: null,
      };
      reviews[input.key] = toJson(next);
      out = next;
      return value;
    });
    if (out === null) throw new Error('Failed to create moderation review');
    return out;
  }

  public async pending(): Promise<readonly ModerationReviewCase[]> {
    const value = root(await this.store.read());
    return Object.values(map(value))
      .map(review)
      .filter((item): item is ModerationReviewCase => item !== null && item.decision === null)
      .sort((a, b) => a.createdAt - b.createdAt || a.key.localeCompare(b.key));
  }

  public async needsApply(): Promise<readonly ModerationReviewCase[]> {
    const value = root(await this.store.read());
    return Object.values(map(value))
      .map(review)
      .filter((item): item is ModerationReviewCase =>
        item !== null && item.decision?.choice === 'approve' && item.appliedActionKey === null)
      .sort((a, b) => a.createdAt - b.createdAt || a.key.localeCompare(b.key));
  }

  public async decide(key: string, nextDecision: ModerationReviewDecision): Promise<ModerationReviewClaim | null> {
    let claim: ModerationReviewClaim | null = null;
    await this.store.edit(current => {
      const value = root(current);
      const reviews = map(value);
      const existing = review(reviews[key]);
      if (existing === null) return value;
      if (existing.decision !== null) {
        claim = { won: false, review: existing };
        return value;
      }
      const decided: ModerationReviewCase = { ...existing, decision: nextDecision, lastError: null };
      reviews[key] = toJson(decided);
      claim = { won: true, review: decided };
      return value;
    });
    return claim;
  }

  public async markApplied(key: string, actionKey: string, at: number): Promise<ModerationReviewCase | null> {
    if (actionKey.trim().length === 0) return null;
    let out: ModerationReviewCase | null = null;
    await this.store.edit(current => {
      const value = root(current);
      const reviews = map(value);
      const existing = review(reviews[key]);
      if (existing === null || existing.decision?.choice !== 'approve') return value;
      if (existing.appliedActionKey !== null) {
        out = existing;
        return value;
      }
      const applied: ModerationReviewCase = {
        ...existing,
        appliedActionKey: actionKey,
        appliedAt: Math.max(0, Math.floor(at)),
        lastError: null,
      };
      reviews[key] = toJson(applied);
      out = applied;
      return value;
    });
    return out;
  }

  public async markFailed(key: string, safeMessage: string): Promise<ModerationReviewCase | null> {
    let out: ModerationReviewCase | null = null;
    await this.store.edit(current => {
      const value = root(current);
      const reviews = map(value);
      const existing = review(reviews[key]);
      if (existing === null || existing.appliedActionKey !== null) return value;
      const failed: ModerationReviewCase = { ...existing, lastError: safeMessage.slice(0, 500) };
      reviews[key] = toJson(failed);
      out = failed;
      return value;
    });
    return out;
  }
}
