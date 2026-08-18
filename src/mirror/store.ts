import { resolve } from 'node:path';
import { isMap, type Json, type JsonMap } from '../types/json.ts';
import { Store } from '../store/store.ts';

export type MirrorMode = 'crosspost' | 'fallback' | 'existing';

export type MirrorPending = {
  readonly key: string;
  readonly sourceSubreddit: string;
  readonly targetSubreddit: string;
  readonly sourcePostId: string;
  readonly sourceFullname: string;
  readonly title: string;
  readonly permalink: string;
  readonly createdUtc: number;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly discoveredAt: number;
};

export type MirrorDiscovery = Omit<MirrorPending, 'key' | 'attempts' | 'lastError'>;

const maxSeen = 4000;
const maxCompleted = 4000;

export const mirrorKey = (subreddit: string, postId: string): string =>
  `${subreddit.toLowerCase()}:${postId}`;

const initial = (): JsonMap => ({
  schema: 2,
  seeded: false,
  seen: [],
  completed: {},
  completedOrder: [],
  pending: {},
});

const root = (value: Json): JsonMap => {
  if (!isMap(value)) throw new Error('Reddit mirror state root is invalid');
  if (value['schema'] === 2) return value;
  // Schema 1 was the short-lived one-way mirror checkpoint. Reset only this
  // disposable mirror index so the bidirectional implementation can seed both
  // current subreddit feeds without backfilling old history.
  if (value['schema'] === 1) return initial();
  throw new Error('Unsupported Reddit mirror state schema');
};

const text = (value: Json | undefined): string => typeof value === 'string' ? value : '';
const num = (value: Json | undefined): number => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const bool = (value: Json | undefined): boolean => value === true;
const strings = (value: Json | undefined): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string')
  : [];

const pending = (value: Json | undefined): MirrorPending | null => {
  if (!isMap(value)) return null;
  const key = text(value['key']);
  const sourceSubreddit = text(value['sourceSubreddit']);
  const targetSubreddit = text(value['targetSubreddit']);
  const sourcePostId = text(value['sourcePostId']);
  const sourceFullname = text(value['sourceFullname']);
  const title = text(value['title']);
  const permalink = text(value['permalink']);
  if (
    key.length === 0
    || sourceSubreddit.length === 0
    || targetSubreddit.length === 0
    || sourcePostId.length === 0
    || sourceFullname.length === 0
    || title.length === 0
    || permalink.length === 0
  ) return null;
  const rawError = text(value['lastError']);
  return {
    key,
    sourceSubreddit,
    targetSubreddit,
    sourcePostId,
    sourceFullname,
    title,
    permalink,
    createdUtc: num(value['createdUtc']),
    attempts: Math.max(0, Math.floor(num(value['attempts']))),
    lastError: rawError.length === 0 ? null : rawError,
    discoveredAt: num(value['discoveredAt']),
  };
};

const pendingJson = (value: MirrorPending): JsonMap => ({
  key: value.key,
  sourceSubreddit: value.sourceSubreddit,
  targetSubreddit: value.targetSubreddit,
  sourcePostId: value.sourcePostId,
  sourceFullname: value.sourceFullname,
  title: value.title,
  permalink: value.permalink,
  createdUtc: value.createdUtc,
  attempts: value.attempts,
  lastError: value.lastError ?? '',
  discoveredAt: value.discoveredAt,
});

const map = (value: JsonMap, key: string): JsonMap => {
  const existing = value[key];
  if (isMap(existing)) return existing;
  const created: JsonMap = {};
  value[key] = created;
  return created;
};

const prependBounded = (items: readonly string[], value: string, limit: number): string[] =>
  [value, ...items.filter(item => item !== value)].slice(0, limit);

const trimCompleted = (state: JsonMap): void => {
  const completed = map(state, 'completed');
  const order = strings(state['completedOrder']).slice(0, maxCompleted);
  const keep = new Set(order);
  for (const key of Object.keys(completed)) {
    if (!keep.has(key)) delete completed[key];
  }
  state['completedOrder'] = order;
};

export class PostMirrorStore {
  private readonly store: Store;

  public constructor(file = resolve(process.cwd(), 'data/postMirror.pb')) {
    this.store = new Store(file, initial());
  }

  public async seeded(): Promise<boolean> {
    return bool(root(await this.store.read())['seeded']);
  }

  public async seed(keys: readonly string[]): Promise<boolean> {
    let changed = false;
    await this.store.edit(current => {
      const value = root(current);
      if (bool(value['seeded'])) return value;
      value['seeded'] = true;
      value['seen'] = [...new Set(keys)].slice(0, maxSeen);
      changed = true;
      return value;
    });
    return changed;
  }

  public async discover(items: readonly MirrorDiscovery[]): Promise<number> {
    let added = 0;
    await this.store.edit(current => {
      const value = root(current);
      const completed = map(value, 'completed');
      const pendingMap = map(value, 'pending');
      const currentSeen = strings(value['seen']);
      const seenSet = new Set(currentSeen);
      let nextSeen = currentSeen;

      for (const item of items) {
        const key = mirrorKey(item.sourceSubreddit, item.sourcePostId);
        if (seenSet.has(key) || typeof completed[key] === 'string' || pending(pendingMap[key]) !== null) continue;
        const next: MirrorPending = {
          ...item,
          key,
          attempts: 0,
          lastError: null,
        };
        pendingMap[key] = pendingJson(next);
        seenSet.add(key);
        nextSeen = prependBounded(nextSeen, key, maxSeen);
        added += 1;
      }
      value['seen'] = nextSeen;
      return value;
    });
    return added;
  }

  public async pending(): Promise<readonly MirrorPending[]> {
    const value = root(await this.store.read());
    const completed = map(value, 'completed');
    const pendingMap = map(value, 'pending');
    return Object.values(pendingMap)
      .map(item => pending(item))
      .filter((item): item is MirrorPending => item !== null && typeof completed[item.key] !== 'string')
      .sort((a, b) => a.createdUtc - b.createdUtc || a.key.localeCompare(b.key));
  }

  public async begin(key: string): Promise<MirrorPending | null> {
    let out: MirrorPending | null = null;
    await this.store.edit(current => {
      const value = root(current);
      const completed = map(value, 'completed');
      const pendingMap = map(value, 'pending');
      if (typeof completed[key] === 'string') return value;
      const existing = pending(pendingMap[key]);
      if (existing === null) return value;
      const next: MirrorPending = { ...existing, attempts: existing.attempts + 1, lastError: null };
      pendingMap[key] = pendingJson(next);
      out = next;
      return value;
    });
    return out;
  }

  public async completePair(sourceKey: string, targetKey: string): Promise<void> {
    await this.store.edit(current => {
      const value = root(current);
      const completed = map(value, 'completed');
      const pendingMap = map(value, 'pending');
      completed[sourceKey] = targetKey;
      completed[targetKey] = sourceKey;
      let order = strings(value['completedOrder']);
      order = prependBounded(order, sourceKey, maxCompleted);
      order = prependBounded(order, targetKey, maxCompleted);
      value['completedOrder'] = order;
      let seen = strings(value['seen']);
      seen = prependBounded(seen, sourceKey, maxSeen);
      seen = prependBounded(seen, targetKey, maxSeen);
      value['seen'] = seen;
      delete pendingMap[sourceKey];
      delete pendingMap[targetKey];
      trimCompleted(value);
      return value;
    });
  }

  public async counterpart(key: string): Promise<string | null> {
    const value = root(await this.store.read());
    const completed = map(value, 'completed');
    const match = completed[key];
    return typeof match === 'string' && match.length > 0 ? match : null;
  }

  public async failed(key: string, safeMessage: string): Promise<void> {
    await this.store.edit(current => {
      const value = root(current);
      const completed = map(value, 'completed');
      const pendingMap = map(value, 'pending');
      if (typeof completed[key] === 'string') return value;
      const existing = pending(pendingMap[key]);
      if (existing === null) return value;
      pendingMap[key] = pendingJson({ ...existing, lastError: safeMessage.slice(0, 500) });
      return value;
    });
  }
}
