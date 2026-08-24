import type { RedditReadClient } from '../reddit/client.ts';
import { safeError } from '../reddit/error.ts';
import type { RedditMutationClient } from '../reddit/mutate.ts';
import { communityFlairRestoresFromFile } from './communityProjection.ts';
import type { CommunityProjectionStore } from './communityProjectionStore.ts';
import { redditMuteAction } from './mutePolicy.ts';
import { reputationDesiredMutes } from './muteReconcile.ts';
import type { ReputationStore } from './store.ts';

export type CommunityProjectionReader = Pick<RedditReadClient, 'userFlairAssignments'>;
export type CommunityProjectionWriter = Pick<
  RedditMutationClient,
  'setUserFlairTemplate' | 'muteUser' | 'unmuteUser'
>;

export type CommunityProjectionTick = {
  readonly applied: number;
  readonly failed: number;
  readonly skipped: boolean;
};

export class CommunityProjectionRuntime {
  private nextAt = 0;

  public constructor(
    private readonly targetSubreddit: string,
    private readonly catalogueFile: string,
    private readonly intervalMs: number,
    private readonly reader: CommunityProjectionReader,
    private readonly writer: CommunityProjectionWriter,
    private readonly reputation: ReputationStore,
    private readonly projection: CommunityProjectionStore,
  ) {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
      throw new Error('Community projection interval must be a positive integer');
    }
  }

  private async reconcileMutes(raw: Awaited<ReturnType<ReputationStore['raw']>>, now: number): Promise<{
    readonly applied: number;
    readonly failed: number;
  }> {
    let applied = 0;
    let failed = 0;
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
        console.error(
          `[Reddit reputation] r/${this.targetSubreddit} ${action} projection failed for u/${desired.username}: ${safeError(error)}`,
        );
      }
    }
    return { applied, failed };
  }

  public async tick(now = Date.now()): Promise<CommunityProjectionTick> {
    if (now < this.nextAt) return { applied: 0, failed: 0, skipped: true };
    this.nextAt = now + this.intervalMs;

    const raw = await this.reputation.raw();
    const muteResult = await this.reconcileMutes(raw, now);
    const assignments = await this.reader.userFlairAssignments(this.targetSubreddit);
    const restores = await communityFlairRestoresFromFile(
      this.catalogueFile,
      raw,
      this.targetSubreddit,
      assignments,
    );

    let applied = muteResult.applied;
    let failed = muteResult.failed;
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
}
