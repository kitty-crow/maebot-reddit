import { resolve } from 'node:path';
import { ReputationStore } from '../reputation/store.ts';
import { Store } from '../store/store.ts';
import { isMap, type Json, type JsonMap } from '../types/json.ts';

/**
 * Persistent moderation reachability and operation-specific 403 cooldowns.
 *
 * A bare 403 is NOT evidence that the user is suspended. It pauses only
 * the rejected operation. A confirmed unreachable state is separate, and
 * never inferred from a single HTTP response.
 */
export type UnreachableUser = {
  readonly username: string;
  readonly firstAt: number;
  readonly operation: string;
  readonly reason: string;
  readonly status: 403;
};

const FIRST_FORBIDDEN_HOLD_MS = 60 * 60 * 1_000;
const MAX_FORBIDDEN_HOLD_MS = 24 * FIRST_FORBIDDEN_HOLD_MS;
const initial = (): JsonMap => ({ schema: 1, users: {}, operations: {} });
const root = (value: Json): JsonMap => {
  if (!isMap(value) || value['schema'] !== 1 || !isMap(value['users'])) {
    throw new Error('Invalid Reddit unreachable-user store');
  }
  if (!isMap(value['operations'])) value['operations'] = {};
  return value;
};
const operationKey = (username: string, operation: string, path: string): string =>
  JSON.stringify([normalise(username), operation, path]);
const normalise = (username: string): string => username.replace(/^u\//iu, '').trim().toLowerCase();

export class RedditUserReachability {
  private readonly store: Store;
  private readonly reputation: ReputationStore;

  public constructor(
    file = resolve(process.cwd(), process.env['REDDIT_UNREACHABLE_USERS_FILE']?.trim() || 'data/redditUnreachableUsers.pb'),
    reputationFile = resolve(process.cwd(), process.env['REDDIT_REPUTATION_STATE_FILE']?.trim() || 'data/reputation.pb'),
    private readonly now: () => number = Date.now,
  ) {
    this.store = new Store(file, initial());
    this.reputation = new ReputationStore(reputationFile);
  }

  public async get(username: string): Promise<UnreachableUser | null> {
    const users = root(await this.store.read())['users'];
    if (!isMap(users)) return null;
    const entry = users[normalise(username)];
    if (!isMap(entry) || entry['status'] !== 403) return null;
    if (typeof entry['username'] !== 'string' || typeof entry['firstAt'] !== 'number'
      || typeof entry['operation'] !== 'string' || typeof entry['reason'] !== 'string') return null;
    return {
      username: entry['username'],
      firstAt: entry['firstAt'],
      operation: entry['operation'],
      reason: entry['reason'],
      status: 403,
    };
  }

  public async isUnreachable(username: string): Promise<boolean> {
    return (await this.get(username)) !== null;
  }

  /** How long should this *particular* action be deferred after a 403? */
  public async operationHoldUntil(username: string, operation: string, path: string): Promise<number | null> {
    const operations = root(await this.store.read())['operations'];
    if (!isMap(operations)) return null;
    const row = operations[operationKey(username, operation, path)];
    if (!isMap(row)) return null;
    const until = row['until'];
    return typeof until === 'number' && Number.isFinite(until) && until > this.now() ? until : null;
  }

  /**
   * Fail closed for one operation, never for the whole user. Repeat failures
   * double the cooldown up to one day. All clients share this store.
   */
  public async holdForbiddenOperation(username: string, operation: string, path: string, reason: string): Promise<number> {
    let until = this.now() + FIRST_FORBIDDEN_HOLD_MS;
    await this.store.edit(current => {
      const value = root(current);
      const operations = value['operations'];
      if (!isMap(operations)) return value;
      const key = operationKey(username, operation, path);
      const old = operations[key];
      const count = isMap(old) && typeof old['count'] === 'number'
        ? Math.max(0, Math.min(20, Math.floor(old['count']))) + 1 : 1;
      const delay = Math.min(MAX_FORBIDDEN_HOLD_MS, FIRST_FORBIDDEN_HOLD_MS * (2 ** Math.min(count - 1, 5)));
      until = this.now() + delay;
      operations[key] = {
        username: normalise(username), operation, path, count, until, status: 403,
        reason: reason.replace(/[\r\n\u0000]/gu, ' ').slice(0, 240),
      };
      return value;
    });
    return until;
  }

  /**
   * For independently confirmed inaccessible accounts only. No mutation
   * endpoint may call this solely because it received HTTP 403.
   */
  public async markUnreachable(username: string, operation: string, reason: string): Promise<void> {
    const key = normalise(username);
    if (!/^[a-z0-9_-]{3,32}$/u.test(key)) throw new Error('Invalid Reddit username for unreachable checkpoint');
    const boundedReason = reason.replace(/[\r\n\u0000]/gu, ' ').slice(0, 240);
    await this.store.edit(current => {
      const value = root(current);
      const users = value['users'];
      if (!isMap(users)) return value;
      if (isMap(users[key]) && users[key]['status'] === 403) return value;
      users[key] = { username, firstAt: Date.now(), operation: operation.slice(0, 100), reason: boundedReason, status: 403 };
      return value;
    });
    // Keep canonical user effects out of the pending queue without pretending
    // that Reddit successfully performed a refused operation.
    await this.reputation.markUserUnreachable(username, operation, boundedReason);
  }
}
