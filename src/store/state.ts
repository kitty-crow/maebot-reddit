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
  readonly sourceUrl: string;
  readonly sourceAt: number;
  readonly createdAt: number;
  readonly lifecycle: 'pending' | 'complete' | 'cancelled';
  readonly primary: TwitterDelivery;
  readonly legacy: TwitterDelivery;
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
    sourceUrl,
    sourceAt: number(value['sourceAt']),
    createdAt: number(value['createdAt']),
    lifecycle,
    primary: delivery(value['primary']),
    legacy: delivery(value['legacy']),
    reviewKey: reviewKey.length === 0 ? null : reviewKey,
    reviewDecision: decision === 'approve' || decision === 'reject' ? decision : null,
    primaryPinApplied: boolean(value['primaryPinApplied']),
    legacyPinApplied: boolean(value['legacyPinApplied']),
    acknowledged: boolean(value['acknowledged']),
  };
};

const fanoutJson = (value: TwitterFanout): JsonMap => ({
  tweetId: value.tweetId,
  sourceUrl: value.sourceUrl,
  sourceAt: value.sourceAt,
  createdAt: value.createdAt,
  lifecycle: value.lifecycle,
  primary: deliveryJson(value.primary),
  legacy: deliveryJson(value.legacy),
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

  public async ensureTwitter(tweetId: string, sourceUrl: string, sourceAt: number, createdAt: number): Promise<TwitterFanout> {
    let out: TwitterFanout | null = null;
    await this.store.edit(current => {
      const value = root(current);
      const twitter = child(value, 'twitter');
      const existing = fanout(twitter[tweetId]);
      if (existing !== null) {
        out = existing;
        return value;
      }
      const empty: TwitterDelivery = { state: 'pending', postId: null, mode: null, updatedAt: createdAt, lastError: null };
      const next: TwitterFanout = {
        tweetId,
        sourceUrl,
        sourceAt,
        createdAt,
        lifecycle: 'pending',
        primary: empty,
        legacy: empty,
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

  public async pendingTwitter(): Promise<readonly TwitterFanout[]> {
    const value = root(await this.store.read());
    return Object.values(child(value, 'twitter'))
      .map(fanout)
      .filter((item): item is TwitterFanout => item !== null && item.lifecycle === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt || a.tweetId.localeCompare(b.tweetId));
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

  public async attachTwitterReview(tweetId: string, reviewKey: string): Promise<TwitterFanout | null> {
    return await this.editTwitter(tweetId, current => ({ ...current, reviewKey }));
  }

  public async decideTwitterReview(tweetId: string, decision: 'approve' | 'reject'): Promise<TwitterFanout | null> {
    return await this.editTwitter(tweetId, current => current.reviewDecision === null
      ? { ...current, reviewDecision: decision }
      : current);
  }

  public async markTwitterPin(tweetId: string, target: 'primary' | 'legacy'): Promise<TwitterFanout | null> {
    return await this.editTwitter(tweetId, current => target === 'primary'
      ? { ...current, primaryPinApplied: true }
      : { ...current, legacyPinApplied: true });
  }

  public async acknowledgeTwitter(tweetId: string): Promise<TwitterFanout | null> {
    return await this.editTwitter(tweetId, current => current.lifecycle === 'complete'
      ? { ...current, acknowledged: true }
      : current);
  }

  public async setQuestion(record: QuestionRecord): Promise<void> {
    await this.store.edit(current => {
      const value = root(current);
      child(value, 'questions')[record.submissionId] = {
        submissionId: record.submissionId,
        title: record.title,
        markerCommentId: record.markerCommentId ?? '',
        bestAnswerCommentId: record.bestAnswerCommentId ?? '',
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
      return value;
    });
  }

  private async editTwitter(
    tweetId: string,
    update: (current: TwitterFanout) => TwitterFanout,
  ): Promise<TwitterFanout | null> {
    let out: TwitterFanout | null = null;
    await this.store.edit(current => {
      const value = root(current);
      const twitter = child(value, 'twitter');
      const existing = fanout(twitter[tweetId]);
      if (existing === null) return value;
      const next = update(existing);
      twitter[tweetId] = fanoutJson(next);
      out = next;
      return value;
    });
    return out;
  }
}
