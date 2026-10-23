import { redditConfig } from '../env.ts';
import { RedditReadClient } from '../reddit/client.ts';
import { safeError } from '../reddit/error.ts';
import { RedditUserReachability } from '../reddit/userReachability.ts';
import type { RedditMutationClient } from '../reddit/mutate.ts';
import type { RedditFlairAssignment } from '../reddit/types.ts';
import { Store } from '../store/store.ts';
import { isMap, type Json, type JsonMap } from '../types/json.ts';
import { redditStateAdoptionInProgress } from './manualOverrideGate.ts';

export type DashboardRedditReader = Pick<
  RedditReadClient,
  | 'userFlairAssignment'
  | 'bannedUser'
  | 'mutedUser'
  | 'userFlairAssignments'
  | 'bannedUsers'
  | 'mutedUsers'
>;

export type DashboardRedditWriter = Pick<
  RedditMutationClient,
  'setUserFlairTemplate' | 'banUser' | 'unbanUser' | 'muteUser' | 'unmuteUser'
>;

type Desired = {
  readonly username: string;
  readonly banned: boolean;
  readonly muted: boolean;
  readonly muteApplied: boolean;
  readonly desiredFlairId: string | null;
  readonly desiredFlairText: string | null;
  readonly currentFlairId: string | null;
  readonly currentFlairText: string | null;
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
  discipline: {},
  notices: {},
  coverage: {},
});

const text = (value: Json | undefined): string | null => typeof value === 'string' ? value : null;
const bool = (value: Json | undefined): boolean => value === true;
const integer = (value: Json | undefined): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
const key = (value: string): string => value.trim().toLowerCase();

const root = (value: Json): JsonMap => {
  if (!isMap(value) || value['schema'] !== 1) throw new Error('Unsupported reputation store');
  if (!isMap(value['users'])) throw new Error('Reputation users map is unavailable');
  if (!isMap(value['discipline'])) value['discipline'] = {};
  return value;
};

const desiredFrom = (value: JsonMap, username: string, now = Date.now()): Desired | null => {
  const users = value['users'];
  if (!isMap(users)) return null;
  const raw = users[key(username)];
  if (!isMap(raw)) return null;
  if (raw['status'] === 'moderator' || bool(raw['immutableModeratorFlair'])) return null;
  const canonicalUsername = text(raw['username']);
  if (canonicalUsername === null || canonicalUsername.trim().length === 0) return null;
  const status = text(raw['status']);
  const banned = status === 'banned' || status === 'scam';
  const discipline = value['discipline'];
  const record = isMap(discipline) ? discipline[key(canonicalUsername)] : undefined;
  const muteUntil = isMap(record) ? integer(record['muteUntil']) : null;
  const muted = isMap(record) && (bool(record['mutePermanent']) || (muteUntil !== null && muteUntil > now));
  const muteApplied = isMap(record) && (bool(record['redditMuted']) || integer(record['muteAppliedAt']) !== null);
  return {
    username: canonicalUsername,
    banned,
    muted,
    muteApplied,
    desiredFlairId: text(raw['desiredFlairTemplateId']),
    desiredFlairText: text(raw['desiredFlairText']),
    currentFlairId: text(raw['currentFlairTemplateId']),
    currentFlairText: text(raw['currentFlairText']),
  };
};

const desiredAll = (value: JsonMap, now = Date.now()): readonly Desired[] => {
  const users = value['users'];
  if (!isMap(users)) return [];
  return Object.values(users).flatMap(raw => {
    if (!isMap(raw)) return [];
    const username = text(raw['username']);
    if (username === null) return [];
    const desired = desiredFrom(value, username, now);
    return desired === null ? [] : [desired];
  }).sort((a, b) => a.username.localeCompare(b.username));
};

const sameFlair = (live: RedditFlairAssignment | null, desired: Desired): boolean => {
  if (desired.desiredFlairId === null) return true;
  if (live === null) return false;
  if (live.templateId !== null) return live.templateId === desired.desiredFlairId;
  return desired.desiredFlairText !== null && live.text === desired.desiredFlairText;
};

export class DashboardRedditReconciler {
  private readonly store: Store;
  private readonly reader: DashboardRedditReader;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly pending = new Set<string>();
  private draining = false;
  private fullReconciling = false;
  private readonly reachability: RedditUserReachability | null;

  public constructor(
    stateFile: string,
    private readonly subreddit: string,
    private readonly writer: DashboardRedditWriter,
    reader: DashboardRedditReader | null = null,
    private readonly fullReconcileMs = 5 * 60 * 1_000,
  ) {
    this.store = new Store(stateFile, initial());
    this.reader = reader ?? new RedditReadClient(redditConfig().auth);
    this.reachability = reader === null ? new RedditUserReachability() : null;
  }

  public start(): void {
    if (this.timer !== null) return;
    void this.reconcileAll().catch(error =>
      console.error(`[Dashboard moderation] Reddit initial reconciliation failed: ${safeError(error)}`));
    this.timer = setInterval(() => {
      void this.reconcileAll().catch(error =>
        console.error(`[Dashboard moderation] Reddit reconciliation failed: ${safeError(error)}`));
    }, this.fullReconcileMs);
    this.timer.unref?.();
  }

  public stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  public queue(username: string): void {
    this.pending.add(key(username));
    void this.drain();
  }

  private async desired(username: string): Promise<Desired | null> {
    return desiredFrom(root(await this.store.read()), username);
  }

  private async markFlairApplied(desired: Desired): Promise<void> {
    if (desired.desiredFlairId === null) return;
    await this.store.edit(current => {
      const value = root(current);
      const users = value['users'];
      if (!isMap(users)) return value;
      const raw = users[key(desired.username)];
      if (!isMap(raw) || raw['desiredFlairTemplateId'] !== desired.desiredFlairId) return value;
      raw['currentFlairTemplateId'] = desired.desiredFlairId;
      raw['currentFlairText'] = desired.desiredFlairText;
      raw['needsFlair'] = false;
      return value;
    });
  }

  private async markMuteApplied(username: string, muted: boolean): Promise<void> {
    await this.store.edit(current => {
      const value = root(current);
      const discipline = value['discipline'];
      if (!isMap(discipline)) return value;
      const record = discipline[key(username)];
      if (!isMap(record)) return value;
      if (muted) {
        if (bool(record['redditMuted']) || integer(record['muteAppliedAt']) !== null) return value;
        record['redditMuted'] = true;
        record['muteAppliedAt'] = Date.now();
      } else {
        record['redditMuted'] = false;
        record['muteAppliedAt'] = null;
      }
      return value;
    });
  }

  private async reconcileDesired(
    desired: Desired,
    live?: {
      readonly banned: boolean;
      readonly muted: boolean;
      readonly flair: RedditFlairAssignment | null;
    },
  ): Promise<void> {
    if (this.reachability !== null && await this.reachability.isUnreachable(desired.username)) return;
    if (redditStateAdoptionInProgress(desired.username)) {
      throw new Error(`Live Reddit state adoption is in progress for u/${desired.username}`);
    }

    const state = live ?? {
      banned: await this.reader.bannedUser(this.subreddit, desired.username) !== null,
      muted: await this.reader.mutedUser(this.subreddit, desired.username) !== null,
      flair: await this.reader.userFlairAssignment(this.subreddit, desired.username),
    };

    if (desired.banned !== state.banned) {
      if (desired.banned) {
        await this.writer.banUser(
          this.subreddit,
          desired.username,
          'Mae canonical moderation state',
          'Mae Dashboard/store reconciliation',
        );
        if (this.reachability !== null && await this.reachability.isUnreachable(desired.username)) return;
        console.log(`[Dashboard moderation] Reddit banned u/${desired.username}.`);
      } else {
        await this.writer.unbanUser(this.subreddit, desired.username);
        if (this.reachability !== null && await this.reachability.isUnreachable(desired.username)) return;
        console.log(`[Dashboard moderation] Reddit unbanned u/${desired.username}.`);
      }
    }
    if (desired.banned) return;

    if (desired.muted) {
      if (!desired.muteApplied && !state.muted) {
        await this.writer.muteUser(this.subreddit, desired.username, 'Mae canonical moderation state');
        if (this.reachability !== null && await this.reachability.isUnreachable(desired.username)) return;
        await this.markMuteApplied(desired.username, true);
        console.log(`[Dashboard moderation] Reddit muted u/${desired.username}.`);
      }
      // If Reddit already has a human-owned mute, leave it untouched and do
      // not claim it. If Mae already applied this sanction once, do not renew
      // it after Reddit's native mute expires or a moderator removes it.
    } else if (desired.muteApplied) {
      if (state.muted) {
        await this.writer.unmuteUser(this.subreddit, desired.username);
        if (this.reachability !== null && await this.reachability.isUnreachable(desired.username)) return;
        console.log(`[Dashboard moderation] Reddit unmuted u/${desired.username}.`);
      }
      await this.markMuteApplied(desired.username, false);
    }

    if (desired.desiredFlairId !== null && !sameFlair(state.flair, desired)) {
      await this.writer.setUserFlairTemplate(
        this.subreddit,
        desired.username,
        desired.desiredFlairId,
        null,
      );
      if (this.reachability !== null && await this.reachability.isUnreachable(desired.username)) return;
      await this.markFlairApplied(desired);
      console.log(`[Dashboard moderation] Reddit flair reconciled for u/${desired.username}.`);
    }
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.size > 0) {
        const username = this.pending.values().next().value as string | undefined;
        if (username === undefined) break;
        this.pending.delete(username);
        try {
          const desired = await this.desired(username);
          if (desired !== null) await this.reconcileDesired(desired);
        } catch (error) {
          console.error(`[Dashboard moderation] Reddit reconcile failed for u/${username}: ${safeError(error)}`);
          this.pending.add(username);
          const retry = setTimeout(() => void this.drain(), 5_000);
          retry.unref?.();
          break;
        }
      }
    } finally {
      this.draining = false;
    }
  }

  public async reconcileAll(): Promise<void> {
    if (this.fullReconciling) return;
    this.fullReconciling = true;
    try {
      const value = root(await this.store.read());
      const desired = desiredAll(value);
      if (desired.length === 0) return;
      const [banned, muted, flairs] = await Promise.all([
        this.reader.bannedUsers(this.subreddit),
        this.reader.mutedUsers(this.subreddit),
        this.reader.userFlairAssignments(this.subreddit),
      ]);
      const bannedSet = new Set(banned.map(item => key(item.username)));
      const mutedSet = new Set(muted.map(item => key(item.username)));
      const flairMap = new Map(flairs.map(item => [key(item.username), item]));

      for (const item of desired) {
        try {
          if (this.reachability !== null && await this.reachability.isUnreachable(item.username)) continue;
          await this.reconcileDesired(item, {
            banned: bannedSet.has(key(item.username)),
            muted: mutedSet.has(key(item.username)),
            flair: flairMap.get(key(item.username)) ?? null,
          });
        } catch (error) {
          console.error(`[Dashboard moderation] Reddit drift repair failed for u/${item.username}: ${safeError(error)}`);
          this.pending.add(key(item.username));
        }
      }
      if (this.pending.size > 0) void this.drain();
    } finally {
      this.fullReconciling = false;
    }
  }
}
