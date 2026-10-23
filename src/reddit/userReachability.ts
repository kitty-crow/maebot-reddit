import { resolve } from 'node:path';
import { ReputationStore } from '../reputation/store.ts';
import { Store } from '../store/store.ts';
import { isMap, type Json, type JsonMap } from '../types/json.ts';

/**
 * Global user-level rejection checkpoint, shared by all Reddit clients.
 *
 * This is intentionally independent of subreddit, flair, or the user's
 * reputation/punishment status. A 403 is recorded as "unreachable" rather
 * than incorrectly interpreted as proof that Reddit banned an account.
 */
export type UnreachableUser = {
  readonly username: string;
  readonly firstAt: number;
  readonly operation: string;
  readonly reason: string;
  readonly status: 403;
};

const initial = (): JsonMap => ({ schema: 1, users: {} });
const root = (value: Json): JsonMap => {
  if (!isMap(value) || value['schema'] !== 1 || !isMap(value['users'])) {
    throw new Error('Invalid Reddit unreachable-user store');
  }
  return value;
};
const normalise = (username: string): string => username.replace(/^u\//iu, '').trim().toLowerCase();

export class RedditUserReachability {
  private readonly store: Store;
  private readonly reputation: ReputationStore;

  public constructor(
    file = resolve(process.cwd(), process.env['REDDIT_UNREACHABLE_USERS_FILE']?.trim() || 'data/redditUnreachableUsers.pb'),
    reputationFile = resolve(process.cwd(), process.env['REDDIT_REPUTATION_STATE_FILE']?.trim() || 'data/reputation.pb'),
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
