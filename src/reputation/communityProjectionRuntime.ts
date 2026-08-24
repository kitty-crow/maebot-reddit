import type { RedditReadClient } from '../reddit/client.ts';
import { safeError } from '../reddit/error.ts';
import type { RedditMutationClient } from '../reddit/mutate.ts';
import { isMap, type Json } from '../types/json.ts';
import {
  communityFlairRestoresFromFile,
  communityProjectionReadyFromFile,
} from './communityProjection.ts';
import type { CommunityProjectionStore } from './communityProjectionStore.ts';
import { redditMuteAction } from './mutePolicy.ts';
import { reputationDesiredMutes } from './muteReconcile.ts';
import type { ReputationStore } from './store.ts';

export type CommunityProjectionReader = Pick<
  RedditReadClient,
  'userFlairAssignments' | 'bannedUsers'
>;
export type CommunityProjectionWriter = Pick<
  RedditMutationClient,
  'setUserFlairTemplate' | 'muteUser' | 'unmuteUser' | 'banUser'
>;

export type CommunityProjectionTick = {
  readonly applied: number;
  readonly failed: number;
  readonly skipped: boolean;
};

type ReconcileResult = {
  readonly applied: number;
  readonly failed: number;
};

type MuteReconcileResult = ReconcileResult & {
  readonly blockedPermanentUsers: ReadonlySet<string>;
};

const lower = (value: string): string => value.trim().toLowerCase();
const canonicalPermanentUsers = (raw: Json): readonly string[] => {
  if (!isMap(raw) || !isMap(raw['users'])) throw new Error('Reputation projection users map is missing');
  const out: string[] = [];
  for (const [key, user] of Object.entries(raw['users'])) {
    if (!isMap(user) || (user['status'] !== 'banned' && user['status'] !== 'scam')) continue;
    const username = typeof user['username'] === 'string' && user['username'].trim().length > 0
      ? user['username']
      : key;
    out.push(username);
  }
  return out.sort((left, right) => left.localeCompare(right));
};

export class CommunityProjectionRuntime {
  private nextFlairAt = 0;
  private activated = false;

  public constructor(
    private readonly sourceSubreddit: string,
    private readonly targetSubreddit: string,
    private readonly catalogueFile: string,
    private readonly flairIntervalMs: number,
    private readonly reader: CommunityProjectionReader,
    private readonly writer: CommunityProjectionWriter,
    private readonly reputation: ReputationStore,
    private readonly projection: CommunityProjectionStore,
  ) {
    if (!Number.isSafeInteger(flairIntervalMs) || flairIntervalMs < 1) {
      throw new Error('Community flair projection interval must be a positive integer');
    }
  }

  private async bootstrapActive(): Promise<boolean> {
    if (this.activated) return true;
    this.activated = await communityProjectionReadyFromFile(
      this.catalogueFile,
      this.sourceSubreddit,
      this.targetSubreddit,
    );
    return this.activated;
  }

  private async reconcileMutes(raw: Json, now: number): Promise<MuteReconcileResult> {
    let applied = 0;
    let failed = 0;
    const blockedPermanentUsers = new Set<string>();
    for (const desired of reputationDesiredMutes(raw, now)) {
      const current = await this.projection.muteState(this.targetSubreddit, desired.username);
      const action = redditMuteAction(
        { muteUntil: desired.muteUntil, permanent: desired.permanent },
        current,
        now,
      );
      if (action === null) continue;
      try {
        if (action === 'mute') {
          await this.writer.muteUser(
            this.targetSubreddit,
            desired.username,
            desired.permanent ? 'Mae permanent reputation enforcement' : 'Mae uncivil reputation state',
          );
        } else {
          await this.writer.unmuteUser(this.targetSubreddit, desired.username);
        }
        await this.projection.markMute(this.targetSubreddit, desired.username, action, now);
        applied += 1;
      } catch (error) {
        failed += 1;
        if (desired.permanent) blockedPermanentUsers.add(lower(desired.username));
        console.error(
          `[Reddit reputation] r/${this.targetSubreddit} ${action} projection failed for u/${desired.username}: ${safeError(error)}`,
        );
      }
    }
    return { applied, failed, blockedPermanentUsers };
  }

  private async reconcileBans(
    raw: Json,
    blockedPermanentUsers: ReadonlySet<string>,
  ): Promise<ReconcileResult> {
    const live = new Set((await this.reader.bannedUsers(this.targetSubreddit)).map(row => lower(row.username)));
    let applied = 0;
    let failed = 0;
    for (const username of canonicalPermanentUsers(raw)) {
      const key = lower(username);
      if (live.has(key) || blockedPermanentUsers.has(key)) continue;
      try {
        await this.writer.banUser(
          this.targetSubreddit,
          username,
          'Mae canonical moderation state',
          `Canonical Mae reputation enforcement projected from r/${this.sourceSubreddit}.`,
        );
        live.add(key);
        applied += 1;
      } catch (error) {
        failed += 1;
        console.error(
          `[Reddit reputation] r/${this.targetSubreddit} ban projection failed for u/${username}: ${safeError(error)}`,
        );
      }
    }
    return { applied, failed };
  }

  private async reconcileFlairs(raw: Json, now: number): Promise<ReconcileResult & { readonly skipped: boolean }> {
    if (now < this.nextFlairAt) return { applied: 0, failed: 0, skipped: true };
    this.nextFlairAt = now + this.flairIntervalMs;
    const assignments = await this.reader.userFlairAssignments(this.targetSubreddit);
    const restores = await communityFlairRestoresFromFile(
      this.catalogueFile,
      raw,
      this.targetSubreddit,
      assignments,
    );

    let applied = 0;
    let failed = 0;
    for (const restore of restores) {
      try {
        await this.writer.setUserFlairTemplate(
          this.targetSubreddit,
          restore.username,
          restore.templateId,
          restore.customText,
        );
        applied += 1;
      } catch (error) {
        failed += 1;
        console.error(
          `[Reddit reputation] r/${this.targetSubreddit} flair projection failed for u/${restore.username}: ${safeError(error)}`,
        );
      }
    }
    return { applied, failed, skipped: false };
  }

  public async tick(now = Date.now()): Promise<CommunityProjectionTick> {
    const raw = await this.reputation.raw();
    const mutes = await this.reconcileMutes(raw, now);
    if (!(await this.bootstrapActive())) {
      return { applied: mutes.applied, failed: mutes.failed, skipped: true };
    }

    const bans = await this.reconcileBans(raw, mutes.blockedPermanentUsers);
    const flairs = await this.reconcileFlairs(raw, now);
    return {
      applied: mutes.applied + bans.applied + flairs.applied,
      failed: mutes.failed + bans.failed + flairs.failed,
      skipped: flairs.skipped,
    };
  }
}
