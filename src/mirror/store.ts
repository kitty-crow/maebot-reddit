import { resolve } from 'node:path';
import { isMap, type Json, type JsonMap } from '../types/json.ts';
import { Store } from '../store/store.ts';

export type MirrorMode = 'crosspost' | 'fallback' | 'existing';

export type MirrorRecord = {
  readonly sourcePostId: string;
  readonly sourceFullname: string;
  readonly title: string;
  readonly permalink: string;
  readonly createdUtc: number;
  readonly state: 'pending' | 'applied';
  readonly legacyPostId: string | null;
  readonly mode: MirrorMode | null;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly discoveredAt: number;
  readonly appliedAt: number | null;
};

const initial = (): JsonMap => ({
  schema: 1,
  seeded: false,
  seen: [],
  records: {},
});

const root = (value: Json): JsonMap => {
  if (!isMap(value) || value['schema'] !== 1) throw new Error('Unsupported Reddit mirror state schema');
  return value;
};

const text = (value: Json | undefined): string => typeof value === 'string' ? value : '';
const num = (value: Json | undefined): number => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const bool = (value: Json | undefined): boolean => value === true;

const record = (value: Json | undefined): MirrorRecord | null => {
  if (!isMap(value)) return null;
  const sourcePostId = text(value['sourcePostId']);
  const sourceFullname = text(value['sourceFullname']);
  const title = text(value['title']);
  const permalink = text(value['permalink']);
  if (sourcePostId.length === 0 || sourceFullname.length === 0 || title.length === 0 || permalink.length === 0) return null;
  const rawMode = value['mode'];
  const mode: MirrorMode | null = rawMode === 'crosspost' || rawMode === 'fallback' || rawMode === 'existing' ? rawMode : null;
  const rawLegacy = text(value['legacyPostId']);
  const rawError = text(value['lastError']);
  return {
    sourcePostId,
    sourceFullname,
    title,
    permalink,
    createdUtc: num(value['createdUtc']),
    state: value['state'] === 'applied' ? 'applied' : 'pending',
    legacyPostId: rawLegacy.length === 0 ? null : rawLegacy,
    mode,
    attempts: Math.max(0, Math.floor(num(value['attempts']))),
    lastError: rawError.length === 0 ? null : rawError,
    discoveredAt: num(value['discoveredAt']),
    appliedAt: value['appliedAt'] === null ? null : num(value['appliedAt']),
  };
};

const recordJson = (value: MirrorRecord): JsonMap => ({
  sourcePostId: value.sourcePostId,
  sourceFullname: value.sourceFullname,
  title: value.title,
  permalink: value.permalink,
  createdUtc: value.createdUtc,
  state: value.state,
  legacyPostId: value.legacyPostId ?? '',
  mode: value.mode ?? '',
  attempts: value.attempts,
  lastError: value.lastError ?? '',
  discoveredAt: value.discoveredAt,
  appliedAt: value.appliedAt,
});

const seen = (value: Json | undefined): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string')
  : [];

export class PostMirrorStore {
  private readonly store: Store;

  public constructor(file = resolve(process.cwd(), 'data/postMirror.pb')) {
    this.store = new Store(file, initial());
  }

  public async seeded(): Promise<boolean> {
    return bool(root(await this.store.read())['seeded']);
  }

  public async seed(postIds: readonly string[]): Promise<boolean> {
    let changed = false;
    await this.store.edit(current => {
      const value = root(current);
      if (bool(value['seeded'])) return value;
      value['seeded'] = true;
      value['seen'] = [...new Set(postIds)].slice(0, 2000);
      changed = true;
      return value;
    });
    return changed;
  }

  public async discover(items: readonly Omit<MirrorRecord, 'state' | 'legacyPostId' | 'mode' | 'attempts' | 'lastError' | 'appliedAt'>[]): Promise<number> {
    let added = 0;
    await this.store.edit(current => {
      const value = root(current);
      const recordsValue = isMap(value['records']) ? value['records'] : {};
      value['records'] = recordsValue;
      const currentSeen = seen(value['seen']);
      const seenSet = new Set(currentSeen);
      const newlySeen: string[] = [];
      for (const item of items) {
        if (seenSet.has(item.sourcePostId)) continue;
        seenSet.add(item.sourcePostId);
        newlySeen.push(item.sourcePostId);
        const next: MirrorRecord = {
          ...item,
          state: 'pending',
          legacyPostId: null,
          mode: null,
          attempts: 0,
          lastError: null,
          appliedAt: null,
        };
        recordsValue[item.sourcePostId] = recordJson(next);
        added += 1;
      }
      value['seen'] = [...newlySeen, ...currentSeen].slice(0, 2000);
      return value;
    });
    return added;
  }

  public async pending(): Promise<readonly MirrorRecord[]> {
    const value = root(await this.store.read());
    const recordsValue = isMap(value['records']) ? value['records'] : {};
    return Object.values(recordsValue)
      .map(item => record(item))
      .filter((item): item is MirrorRecord => item !== null && item.state === 'pending')
      .sort((a, b) => a.createdUtc - b.createdUtc || a.sourcePostId.localeCompare(b.sourcePostId));
  }

  public async begin(sourcePostId: string): Promise<MirrorRecord | null> {
    let out: MirrorRecord | null = null;
    await this.store.edit(current => {
      const value = root(current);
      const recordsValue = isMap(value['records']) ? value['records'] : {};
      value['records'] = recordsValue;
      const existing = record(recordsValue[sourcePostId]);
      if (existing === null || existing.state === 'applied') return value;
      const next: MirrorRecord = { ...existing, attempts: existing.attempts + 1, lastError: null };
      recordsValue[sourcePostId] = recordJson(next);
      out = next;
      return value;
    });
    return out;
  }

  public async applied(sourcePostId: string, legacyPostId: string, mode: MirrorMode, at: number): Promise<void> {
    await this.store.edit(current => {
      const value = root(current);
      const recordsValue = isMap(value['records']) ? value['records'] : {};
      value['records'] = recordsValue;
      const existing = record(recordsValue[sourcePostId]);
      if (existing === null) return value;
      recordsValue[sourcePostId] = recordJson({
        ...existing,
        state: 'applied',
        legacyPostId,
        mode,
        lastError: null,
        appliedAt: at,
      });
      return value;
    });
  }

  public async failed(sourcePostId: string, safeMessage: string): Promise<void> {
    await this.store.edit(current => {
      const value = root(current);
      const recordsValue = isMap(value['records']) ? value['records'] : {};
      value['records'] = recordsValue;
      const existing = record(recordsValue[sourcePostId]);
      if (existing === null || existing.state === 'applied') return value;
      recordsValue[sourcePostId] = recordJson({ ...existing, lastError: safeMessage.slice(0, 500) });
      return value;
    });
  }
}
