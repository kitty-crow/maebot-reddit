import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { isMap, type Json, type JsonMap } from '../types/json.ts';
import { Store } from '../store/store.ts';

export type DevvitWire =
  | null
  | boolean
  | number
  | string
  | DevvitWire[]
  | { readonly [key: string]: DevvitWire };

export type DevvitRpcStep =
  | { readonly kind: 'get'; readonly name: string }
  | { readonly kind: 'call'; readonly name: string; readonly args: readonly DevvitWire[] }
  | { readonly kind: 'find'; readonly name: string; readonly equals: DevvitWire };

export type DevvitRpcCommand = {
  readonly id: string;
  readonly root: 'reddit' | 'media';
  readonly steps: readonly DevvitRpcStep[];
};

export type DevvitRpcResult = {
  readonly id: string;
  readonly ok: boolean;
  readonly value?: DevvitWire;
  readonly error?: string;
};

type StoredCommand = DevvitRpcCommand & {
  readonly state: 'queued' | 'leased' | 'done';
  readonly createdAt: number;
  readonly leaseUntil: number;
  readonly result: DevvitRpcResult | null;
};

const initial = (): JsonMap => ({ schema: 1, commands: {}, comments: {} });

const root = (value: Json): JsonMap => {
  if (
    !isMap(value)
    || value['schema'] !== 1
    || !isMap(value['commands'])
    || (value['comments'] !== undefined && !isMap(value['comments']))
  ) {
    throw new Error('Unsupported Devvit RPC spool');
  }
  return value;
};

const text = (value: Json | undefined): string => typeof value === 'string' ? value : '';
const number = (value: Json | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const wire = (value: Json | undefined): DevvitWire => {
  if (
    value === null
    || typeof value === 'boolean'
    || typeof value === 'number'
    || typeof value === 'string'
  ) return value;
  if (Array.isArray(value)) return value.map(item => wire(item));
  if (isMap(value)) {
    const out: { [key: string]: DevvitWire } = {};
    for (const [key, child] of Object.entries(value)) out[key] = wire(child);
    return out;
  }
  throw new Error('Invalid Devvit RPC wire value');
};

const step = (value: Json | undefined): DevvitRpcStep | null => {
  if (!isMap(value)) return null;
  const kind = text(value['kind']);
  const name = text(value['name']);
  if (kind === 'get') return { kind, name };
  if (kind === 'find') {
    if (value['equals'] === undefined) return null;
    return { kind, name, equals: wire(value['equals']) };
  }
  if (kind !== 'call' || !Array.isArray(value['args'])) return null;
  return { kind, name, args: value['args'].map(item => wire(item)) };
};

const result = (value: Json | undefined): DevvitRpcResult | null => {
  if (!isMap(value)) return null;
  const id = text(value['id']);
  const ok = value['ok'];
  if (id.length === 0 || typeof ok !== 'boolean') return null;
  const error = text(value['error']);
  return {
    id,
    ok,
    ...(value['value'] === undefined ? {} : { value: wire(value['value']) }),
    ...(error.length === 0 ? {} : { error }),
  };
};

const stored = (id: string, value: Json | undefined): StoredCommand | null => {
  if (!isMap(value) || !Array.isArray(value['steps'])) return null;
  const rootName = value['root'];
  const state = value['state'];
  if (rootName !== 'reddit' && rootName !== 'media') return null;
  if (state !== 'queued' && state !== 'leased' && state !== 'done') return null;
  const steps = value['steps'].map(item => step(item));
  if (steps.some(item => item === null)) return null;
  return {
    id,
    root: rootName,
    steps: steps.filter((item): item is DevvitRpcStep => item !== null),
    state,
    createdAt: number(value['createdAt']),
    leaseUntil: number(value['leaseUntil']),
    result: value['result'] === null || value['result'] === undefined ? null : result(value['result']),
  };
};

const stepJson = (value: DevvitRpcStep): JsonMap => {
  if (value.kind === 'get') return { kind: value.kind, name: value.name };
  if (value.kind === 'find') return { kind: value.kind, name: value.name, equals: value.equals };
  return { kind: value.kind, name: value.name, args: [...value.args] };
};

const resultJson = (value: DevvitRpcResult): JsonMap => ({
  id: value.id,
  ok: value.ok,
  ...(value.value === undefined ? {} : { value: value.value }),
  ...(value.error === undefined ? {} : { error: value.error }),
});

const commandJson = (value: StoredCommand): JsonMap => ({
  root: value.root,
  steps: value.steps.map(stepJson),
  state: value.state,
  createdAt: value.createdAt,
  leaseUntil: value.leaseUntil,
  result: value.result === null ? null : resultJson(value.result),
});

const commands = (value: JsonMap): JsonMap => {
  const map = value['commands'];
  if (!isMap(map)) throw new Error('Devvit RPC command map is invalid');
  return map;
};

const comments = (value: JsonMap): JsonMap => {
  const existing = value['comments'];
  if (isMap(existing)) return existing;
  const created: JsonMap = {};
  value['comments'] = created;
  return created;
};

export class DevvitRpcSpool {
  private static readonly waiters = new Map<string, Set<() => void>>();
  private readonly store: Store;
  private readonly file: string;

  public constructor(file = resolve(process.cwd(), 'data/devvitRpc.pb')) {
    this.file = resolve(file);
    this.store = new Store(this.file, initial());
  }

  private signal(): void {
    const waiting = DevvitRpcSpool.waiters.get(this.file);
    if (waiting === undefined) return;
    DevvitRpcSpool.waiters.delete(this.file);
    for (const wake of waiting) wake();
  }

  private async wait(timeoutMs: number): Promise<void> {
    await new Promise<void>(resolveWait => {
      const waiting = DevvitRpcSpool.waiters.get(this.file) ?? new Set<() => void>();
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        waiting.delete(finish);
        if (waiting.size === 0) DevvitRpcSpool.waiters.delete(this.file);
        resolveWait();
      };
      waiting.add(finish);
      DevvitRpcSpool.waiters.set(this.file, waiting);
      const timer = setTimeout(finish, timeoutMs);
    });
  }

  public async enqueue(
    rootName: DevvitRpcCommand['root'],
    steps: readonly DevvitRpcStep[],
    at = Date.now(),
  ): Promise<string> {
    const id = randomUUID();
    await this.store.edit(current => {
      const value = root(current);
      commands(value)[id] = commandJson({
        id,
        root: rootName,
        steps,
        state: 'queued',
        createdAt: at,
        leaseUntil: 0,
        result: null,
      });
      return value;
    });
    this.signal();
    return id;
  }

  public async lease(limit = 25, at = Date.now()): Promise<readonly DevvitRpcCommand[]> {
    const out: DevvitRpcCommand[] = [];
    await this.store.edit(current => {
      const value = root(current);
      const map = commands(value);
      const available = Object.entries(map)
        .map(([id, raw]) => stored(id, raw))
        .filter((item): item is StoredCommand =>
          item !== null && (item.state === 'queued' || (item.state === 'leased' && item.leaseUntil <= at)))
        .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
        .slice(0, Math.max(1, Math.min(100, Math.floor(limit))));
      for (const item of available) {
        const leased: StoredCommand = { ...item, state: 'leased', leaseUntil: at + 30_000 };
        map[item.id] = commandJson(leased);
        out.push({ id: item.id, root: item.root, steps: item.steps });
      }
      return value;
    });
    return out;
  }

  public async waitForWork(
    limit = 25,
    timeoutMs = 25_000,
  ): Promise<readonly DevvitRpcCommand[]> {
    const first = await this.lease(limit);
    if (first.length > 0) return first;
    await this.wait(Math.max(1, Math.min(25_000, Math.floor(timeoutMs))));
    return await this.lease(limit);
  }

  public async complete(input: DevvitRpcResult): Promise<void> {
    await this.store.edit(current => {
      const value = root(current);
      const map = commands(value);
      const existing = stored(input.id, map[input.id]);
      if (existing === null) return value;
      map[input.id] = commandJson({
        ...existing,
        state: 'done',
        leaseUntil: 0,
        result: input,
      });
      return value;
    });
    this.signal();
  }

  public async take(id: string): Promise<DevvitRpcResult | null> {
    let out: DevvitRpcResult | null = null;
    await this.store.edit(current => {
      const value = root(current);
      const map = commands(value);
      const existing = stored(id, map[id]);
      if (existing?.state !== 'done' || existing.result === null) return value;
      out = existing.result;
      delete map[id];
      return value;
    });
    return out;
  }

  public async waitForResult(id: string, timeoutMs: number): Promise<DevvitRpcResult | null> {
    const deadline = Date.now() + Math.max(1, Math.floor(timeoutMs));
    while (true) {
      const current = await this.take(id);
      if (current !== null) return current;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      await this.wait(remaining);
    }
  }

  public async cancel(id: string): Promise<void> {
    await this.store.edit(current => {
      const value = root(current);
      delete commands(value)[id];
      return value;
    });
  }

  public async recordComment(event: Json, at = Date.now()): Promise<void> {
    if (!isMap(event)) throw new Error('Devvit comment event must be an object');
    const rawComment = event['comment'];
    const rawSubreddit = event['subreddit'];
    if (!isMap(rawComment)) throw new Error('Devvit comment event has no comment');
    const id = text(rawComment['id']);
    const subreddit = isMap(rawSubreddit) ? text(rawSubreddit['name']) : '';
    if (id.length === 0 || subreddit.length === 0) {
      throw new Error('Devvit comment event is missing id or subreddit');
    }
    await this.store.edit(current => {
      const value = root(current);
      const map = comments(value);
      map[id] = { at, subreddit: subreddit.toLowerCase(), event };
      const ordered = Object.entries(map)
        .map(([key, raw]) => ({
          key,
          at: isMap(raw) ? number(raw['at']) : 0,
        }))
        .sort((left, right) => right.at - left.at || left.key.localeCompare(right.key));
      for (const stale of ordered.slice(2_000)) delete map[stale.key];
      return value;
    });
  }

  public async recentCommentEvents(subreddit: string, limit: number): Promise<readonly Json[]> {
    const wanted = subreddit.trim().toLowerCase();
    const safeLimit = Math.max(1, Math.min(1_000, Math.floor(limit)));
    const value = root(await this.store.read());
    return Object.values(comments(value))
      .filter((raw): raw is JsonMap =>
        isMap(raw)
        && text(raw['subreddit']) === wanted
        && isMap(raw['event']))
      .sort((left, right) => number(right['at']) - number(left['at']))
      .slice(0, safeLimit)
      .map(raw => raw['event'] ?? null);
  }
}

export const encodeDevvitWire = (value: object | readonly object[] | string | number | boolean | null): DevvitWire => {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Uint8Array) return { $bytes: Buffer.from(value).toString('base64') };
  if (value instanceof ArrayBuffer) return { $bytes: Buffer.from(value).toString('base64') };
  if (Array.isArray(value)) return value.map(item => encodeDevvitWire(item));
  const out: { [key: string]: DevvitWire } = {};
  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) out[key] = encodeDevvitWire(child as object | readonly object[] | string | number | boolean | null);
  }
  return out;
};

export const decodeDevvitWire = (value: DevvitWire): Json | Uint8Array => {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(item => decodeDevvitWire(item) as Json);
  const bytes = value['$bytes'];
  if (typeof bytes === 'string' && Object.keys(value).length === 1) {
    return Uint8Array.from(Buffer.from(bytes, 'base64'));
  }
  const wide = value['$bigint'];
  if (typeof wide === 'string' && Object.keys(value).length === 1) return wide;
  const out: JsonMap = {};
  for (const [key, child] of Object.entries(value)) out[key] = decodeDevvitWire(child) as Json;
  return out;
};

export class DevvitRpcClient {
  public constructor(
    private readonly spool: DevvitRpcSpool,
    private readonly timeoutMs = 120_000,
  ) {}

  public async call(
    rootName: DevvitRpcCommand['root'],
    steps: readonly DevvitRpcStep[],
  ): Promise<DevvitWire> {
    const id = await this.spool.enqueue(rootName, steps);
    try {
      const value = await this.spool.waitForResult(id, this.timeoutMs);
      if (value === null) throw new Error(`Devvit Reddit RPC ${id} timed out`);
      if (!value.ok) throw new Error(value.error ?? 'Devvit Reddit RPC failed');
      return value.value ?? null;
    } finally {
      await this.spool.cancel(id);
    }
  }
}
