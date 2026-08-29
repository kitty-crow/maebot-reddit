import { isMap, type Json, type JsonMap } from '../types/json.ts';
import { Store } from './store.ts';

export type ActionState = 'pending' | 'applying' | 'applied' | 'failed' | 'cancelled';
export type RedditActionKind =
  | 'post'
  | 'crosspost'
  | 'remove'
  | 'approve'
  | 'lock'
  | 'sticky'
  | 'flair'
  | 'comment'
  | 'edit';

export type RedditAction = {
  readonly key: string;
  readonly kind: RedditActionKind;
  readonly target: string;
  readonly reason: string;
  readonly policy: string;
  readonly createdAt: number;
  readonly state: ActionState;
  readonly actor: string;
  readonly oldState: Json;
  readonly newState: Json;
  readonly reviewKey: string | null;
  readonly externalId: string | null;
  readonly appliedAt: number | null;
  readonly attempts: number;
  readonly lastError: string | null;
};

export type RedditActionInput = Omit<RedditAction,
  'state' | 'externalId' | 'appliedAt' | 'attempts' | 'lastError'>;

export type TwitterDelivery = {
  readonly state: 'pending' | 'applied' | 'failed';
  readonly postId: string | null;
  readonly mode: 'primary' | 'crosspost' | 'fallback' | null;
  readonly updatedAt: number;
  readonly lastError: string | null;
};

export type TwitterFanout = {
  readonly tweetId: string;
  readonly account: string;
  readonly sourceUrl: string;
  readonly sourceAt: number;
  readonly createdAt: number;
  readonly lifecycle: 'pending' | 'complete' | 'cancelled';
  readonly primary: TwitterDelivery;
  readonly legacy: TwitterDelivery;
  readonly worthy: boolean | null;
  readonly reviewKey: string | null;
  readonly reviewDecision: 'approve' | 'reject' | null;
  readonly primaryPinApplied: boolean;
  readonly legacyPinApplied: boolean;
  readonly acknowledged: boolean;
};

export type QuestionRecord = {
  readonly submissionId: string;
  readonly title: string;
  readonly markerCommentId: string | null;
  readonly bestAnswerCommentId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
};

const initial = (): JsonMap => ({
  schema: 1,
  actions: {},
  twitter: {},
  questions: {},
  users: {},
  community: {
    titm: { total: 0, leaderboard: {} },
    haiku: { history: {} },
  },
});

const root = (value: Json): JsonMap => {
  if (!isMap(value)) throw new Error('Reddit state root is invalid');
  if (value['schema'] !== 1) throw new Error('Unsupported Reddit state schema');
  return value;
};

const child = (parent: JsonMap, key: string): JsonMap => {
  const value = parent[key];
  if (isMap(value)) return value;
  const created: JsonMap = {};
  parent[key] = created;
  return created;
};

const text = (value: Json | undefined): string => typeof value === 'string' ? value : '';
const number = (value: Json | undefined): number => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const boolean = (value: Json | undefined): boolean => value === true;
const maybeBoolean = (value: Json | undefined): boolean | null => typeof value === 'boolean' ? value : null;

const action = (value: Json | undefined): RedditAction | null => {
  if (!isMap(value)) return null;
  const kind = value['kind'];
  const state = value['state'];
  if (
    kind !== 'post' && kind !== 'crosspost' && kind !== 'remove' && kind !== 'approve'
    && kind !== 'lock' && kind !== 'sticky' && kind !== 'flair' && kind !== 'comment' && kind !== 'edit'
  ) return null;
  if (state !== 'pending' && state !== 'applying' && state !== 'applied' && state !== 'failed' && state !== 'cancelled') return null;
  const key = text(value['key']);
  const target = text(value['target']);
  if (key.length === 0 || target.length === 0) return null;
  const reviewKey = text(value['reviewKey']);
  const externalId = text(value['externalId']);
  const lastError = text(value['lastError']);
  return {
    key,
    kind,
    target,
    reason: text(value['reason']),
    policy: text(value['policy']),
    createdAt: number(value['createdAt']),
    state,
    actor: text(value['actor']),
    oldState: value['oldState'] ?? null,
    newState: value['newState'] ?? null,
    reviewKey: reviewKey.length === 0 ? null : reviewKey,
    externalId: externalId.length === 0 ? null : externalId,
    appliedAt: value['appliedAt'] === null ? null : number(value['appliedAt']),
    attempts: Math.max(0, Math.floor(number(value['attempts']))),
    lastError: lastError.length === 0 ? null : lastError,
  };
};

const actionJson = (value: RedditAction): JsonMap => ({
  key: value.key,
  kind: value.kind,
  target: value.target,
  reason: value.reason,
  policy: value.policy,
  createdAt: value.createdAt,
  state: value.state,
  actor: value.actor,
  oldState: value.oldState,
  newState: value.newState,
  reviewKey: value.reviewKey ?? '',
  externalId: value.externalId ?? '',
  appliedAt: value.appliedAt,
  attempts: value.attempts,
  lastError: value.lastError ?? '',
});

const delivery = (value: Json | undefined): TwitterDelivery => {
  if (!isMap(value)) return { state: 'pending', postId: null, mode: null, updatedAt: 0, lastError: null };
  const state = value['state'] === 'applied' || value['state'] === 'failed' ? value['state'] : 'pending';
  const mode = value['mode'];
  const postId = text(value['postId']);
  const lastError = text(value['lastError']);
  return {
    state,
    postId: postId.length === 0 ? null : postId,
    mode: mode === 'primary' || mode === 'crosspost' || mode === 'fallback' ? mode : null,
    updatedAt: number(value['updatedAt']),
    lastError: lastError.length === 0 ? null : lastError,
  };
};

const deliveryJson = (value: TwitterDelivery): JsonMap => ({
  state: value.state,
  postId: value.postId ?? '',
  mode: value.mode ?? '',
  updatedAt: value.updatedAt,
  lastError: value.lastError ?? '',
});

const fanout = (value: Json | undefined): TwitterFanout | null => {
  if (!isMap(value)) return null;
  const tweetId = text(value['tweetId']);
  const sourceUrl = text(value['sourceUrl']);
  if (tweetId.length === 0 || sourceUrl.length === 0) return null;
  const lifecycle = value['lifecycle'] === 'complete' || value['lifecycle'] === 'cancelled' ? value['lifecycle'] : 'pending';
  const reviewKey = text(value['reviewKey']);
  const decision = value['reviewDecision'];
  return {
    tweetId,
    account: text(value['account']),
    sourceUrl,
    sourceAt: number(value['sourceAt']),
    createdAt: number(value['createdAt']),
    lifecycle,
    primary: delivery(value['primary']),
    legacy: delivery(value['legacy']),
    worthy: maybeBoolean(value['worthy']),
    reviewKey: reviewKey.length === 0 ? null : reviewKey,
    reviewDecision: decision === 'approve' || decision === 'reject' ? decision : null,
    primaryPinApplied: boolean(value['primaryPinApplied']),
    legacyPinApplied: boolean(value['legacyPinApplied']),
    acknowledged: boolean(value['acknowledged']),
  };
};

const fanoutJson = (value: TwitterFanout): JsonMap => ({
  tweetId: value.tweetId,
  account: value.account,
  sourceUrl: value.sourceUrl,
  sourceAt: value.sourceAt,
  createdAt: value.createdAt,
  lifecycle: value.lifecycle,
  primary: deliveryJson(value.primary),
  legacy: deliveryJson(value.legacy),
  worthy: value.worthy,
  reviewKey: value.reviewKey ?? '',
  reviewDecision: value.reviewDecision ?? '',
  primaryPinApplied: value.primaryPinApplied,
  legacyPinApplied: value.legacyPinApplied,
  acknowledged: value.acknowledged,
});

export class RedditStateStore {
  private readonly store: Store;

  public constructor(file = 'data/reddit.pb') {
    this.store = new Store(file, initial());
  }

  public async action(key: string): Promise<RedditAction | null> {
    const value = root(await this.store.read());
    return action(child(value, 'actions')[key]);
  }

  public async ensureAction(input: RedditActionInput): Promise<RedditAction> {
    let out: RedditAction | null = null;
    await this.store.edit(current => {
      const value = root(current);
      const actions = child(value, 'actions');
      const existing = action(actions[input.key]);
      if (existing !== null) {
        out = existing;
        return value;
      }
      const next: RedditAction = {
        ...input,
        state: 'pending',
        externalId: null,
        appliedAt: null,
        attempts: 0,
        lastError: null,
      };
      actions[input.key] = actionJson(next);
      out = next;
      return value;
    });
    if (out === null) throw new Error('Failed to ensure Reddit action');
    return out;
  }

  public async beginAction(key: string): Promise<RedditAction | null> {
    let out: RedditAction | null = null;
    await this.store.edit(current => {
      const value = root(current);
      const actions = child(value, 'actions');
      const existing = action(actions[key]);
      if (existing === null || existing.state === 'applied' || existing.state === 'cancelled') return value;
      const next: RedditAction = { ...existing, state: 'applying', attempts: existing.attempts + 1, lastError: null };
      actions[key] = actionJson(next);
      out = next;
      return value;
    });
    return out;
  }

  public async markActionApplied(key: string, externalId: string | null, at: number): Promise<RedditAction | null> {
    let out: RedditAction | null = null;
    await this.store.edit(current => {
      const value = root(current);
      const actions = child(value, 'actions');
      const existing = action(actions[key]);
      if (existing === null) return value;
      if (existing.state === 'applied') {
        out = existing;
        return value;
      }
      const next: RedditAction = { ...existing, state: 'applied', externalId, appliedAt: at, lastError: null };
      actions[key] = actionJson(next);
      out = next;
      return value;
    });
    return out;
  }

  public async markActionFailed(key: string, safeMessage: string): Promise<RedditAction | null> {
    let out: RedditAction | null = null;
    await this.store.edit(current => {
      const value = root(current);
      const actions = child(value, 'actions');
      const existing = action(actions[key]);
      if (existing === null || existing.state === 'applied' || existing.state === 'cancelled') return value;
      const next: RedditAction = { ...existing, state: 'failed', lastError: safeMessage.slice(0, 500) };
      actions[key] = actionJson(next);
      out = next;
      return value;
    });
    return out;
  }

  public async ensureTwitter(
    tweetId: string,
    sourceUrl: string,
    sourceAt: number,
    createdAt: number,
    account = '',
    worthy: boolean | null = null,
  ): Promise<TwitterFanout> {
    let out: TwitterFanout | null = null;
    await this.store.edit(current => {
      const value = root(current);
      const twitter = child(value, 'twitter');
      const existing = fanout(twitter[tweetId]);
      if (existing !== null) {
        const next = {
          ...existing,
          account: existing.account.length > 0 ? existing.account : account,
          worthy: worthy ?? existing.worthy,
        };
        twitter[tweetId] = fanoutJson(next);
        out = next;
        return value;
      }
      const empty: TwitterDelivery = { state: 'pending', postId: null, mode: null, updatedAt: createdAt, lastError: null };
      const next: TwitterFanout = {
        tweetId,
        account,
        sourceUrl,
        sourceAt,
        createdAt,
        lifecycle: 'pending',
        primary: empty,
        legacy: empty,
        worthy,
        reviewKey: null,
        reviewDecision: null,
        primaryPinApplied: false,
        legacyPinApplied: false,
        acknowledged: false,
      };
      twitter[tweetId] = fanoutJson(next);
      out = next;
      return value;
    });
    if (out === null) throw new Error('Failed to ensure Twitter Reddit fanout');
    return out;
  }

  public async twitter(tweetId: string): Promise<TwitterFanout | null> {
    const value = root(await this.store.read());
    return fanout(child(value, 'twitter')[tweetId]);
  }

  public async pendingTwitter(): Promise<readonly TwitterFanout[]> {
    return await this.twitterWhere(item => item.lifecycle === 'pending');
  }

  public async unacknowledgedTwitter(): Promise<readonly TwitterFanout[]> {
    return await this.twitterWhere(item => item.lifecycle === 'complete' && !item.acknowledged);
  }

  public async twitterReviewCandidates(): Promise<readonly TwitterFanout[]> {
    return await this.twitterWhere(item =>
      item.worthy !== false
      && (
        item.reviewDecision === null
        || (
          item.lifecycle === 'complete'
          && item.reviewDecision === 'approve'
          && (!item.primaryPinApplied || !item.legacyPinApplied)
        )
      ));
  }

  public async markTwitterDelivery(
    tweetId: string,
    target: 'primary' | 'legacy',
    postId: string,
    mode: 'primary' | 'crosspost' | 'fallback',
    at: number,
  ): Promise<TwitterFanout | null> {
    let out: TwitterFanout | null = null;
    await this.store.edit(current => {
      const value = root(current);
      const twitter = child(value, 'twitter');
      const existing = fanout(twitter[tweetId]);
      if (existing === null || existing.lifecycle !== 'pending') return value;
      const applied: TwitterDelivery = { state: 'applied', postId, mode, updatedAt: at, lastError: null };
      const next: TwitterFanout = { ...existing, [target]: applied };
      const complete = next.primary.state === 'applied' && next.legacy.state === 'applied';
      const final: TwitterFanout = complete ? { ...next, lifecycle: 'complete' } : next;
      twitter[tweetId] = fanoutJson(final);
      out = final;
      return value;
    });
    return out;
  }

  public async markTwitterDeliveryFailed(
    tweetId: string,
    target: 'primary' | 'legacy',
    safeMessage: string,
    at: number,
  ): Promise<TwitterFanout | null> {
    return await this.editTwitter(tweetId, current => {
      if (current.lifecycle !== 'pending' || current[target].state === 'applied') return current;
      const failed: TwitterDelivery = {
        state: 'failed',
        postId: current[target].postId,
        mode: current[target].mode,
        updatedAt: at,
        lastError: safeMessage.slice(0, 500),
      };
      return { ...current, [target]: failed };
    });
  }

  public async syncTwitterCanonical(
    tweetId: string,
    account: string,
    worthy: boolean | null,
    reviewKey: string | null,
  ): Promise<TwitterFanout | null> {
    return await this.editTwitter(tweetId, current => ({
      ...current,
      account: account.length > 0 ? account : current.account,
      worthy: worthy ?? current.worthy,
      reviewKey: reviewKey ?? current.reviewKey,
    }));
  }

  public async attachTwitterReview(tweetId: string, reviewKey: string): Promise<TwitterFanout | null> {
    return await this.editTwitter(tweetId, current => ({ ...current, reviewKey }));
  }

  public async decideTwitterReview(
    tweetId: string,
    decision: 'approve' | 'reject',
  ): Promise<TwitterFanout | null> {
    return await this.editTwitter(tweetId, current => {
      if (current.reviewDecision !== null) return current;
      return { ...current, reviewDecision: decision };
    });
  }

  public async markTwitterPin(tweetId: string, target: 'primary' | 'legacy'): Promise<TwitterFanout | null> {
    return await this.editTwitter(tweetId, current =>
      target === 'primary'
        ? { ...current, primaryPinApplied: true }
        : { ...current, legacyPinApplied: true });
  }

  public async acknowledgeTwitter(tweetId: string): Promise<TwitterFanout | null> {
    return await this.editTwitter(tweetId, current => ({ ...current, acknowledged: true }));
  }

  public async question(submissionId: string): Promise<QuestionRecord | null> {
    const value = root(await this.store.read());
    return this.questionRecord(child(value, 'questions')[submissionId]);
  }

  public async saveQuestion(input: QuestionRecord): Promise<QuestionRecord> {
    await this.store.edit(current => {
      const value = root(current);
      child(value, 'questions')[input.submissionId] = {
        submissionId: input.submissionId,
        title: input.title,
        markerCommentId: input.markerCommentId ?? '',
        bestAnswerCommentId: input.bestAnswerCommentId ?? '',
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      };
      return value;
    });
    return input;
  }

  public async questionRecords(): Promise<readonly QuestionRecord[]> {
    const value = root(await this.store.read());
    return Object.values(child(value, 'questions'))
      .map(item => this.questionRecord(item))
      .filter((item): item is QuestionRecord => item !== null)
      .sort((a, b) => a.createdAt - b.createdAt || a.submissionId.localeCompare(b.submissionId));
  }

  private questionRecord(value: Json | undefined): QuestionRecord | null {
    if (!isMap(value)) return null;
    const submissionId = text(value['submissionId']);
    if (submissionId.length === 0) return null;
    const markerCommentId = text(value['markerCommentId']);
    const bestAnswerCommentId = text(value['bestAnswerCommentId']);
    return {
      submissionId,
      title: text(value['title']),
      markerCommentId: markerCommentId.length === 0 ? null : markerCommentId,
      bestAnswerCommentId: bestAnswerCommentId.length === 0 ? null : bestAnswerCommentId,
      createdAt: number(value['createdAt']),
      updatedAt: number(value['updatedAt']),
    };
  }

  private async twitterWhere(predicate: (value: TwitterFanout) => boolean): Promise<readonly TwitterFanout[]> {
    const value = root(await this.store.read());
    return Object.values(child(value, 'twitter'))
      .map(item => fanout(item))
      .filter((item): item is TwitterFanout => item !== null && predicate(item))
      .sort((a, b) => a.createdAt - b.createdAt || a.tweetId.localeCompare(b.tweetId));
  }

  private async editTwitter(
    tweetId: string,
    edit: (current: TwitterFanout) => TwitterFanout,
  ): Promise<TwitterFanout | null> {
    let out: TwitterFanout | null = null;
    await this.store.edit(current => {
      const value = root(current);
      const twitter = child(value, 'twitter');
      const existing = fanout(twitter[tweetId]);
      if (existing === null) return value;
      const next = edit(existing);
      twitter[tweetId] = fanoutJson(next);
      out = next;
      return value;
    });
    return out;
  }
}
