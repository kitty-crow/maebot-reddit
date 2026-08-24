import { communityFlairRestoresFromFile } from './communityProjection.ts';
import type { ReputationStore } from './store.ts';
import type { RedditReadClient } from '../reddit/client.ts';
import { safeError } from '../reddit/error.ts';
import type { RedditMutationClient } from '../reddit/mutate.ts';

export type CommunityProjectionReader = Pick<RedditReadClient, 'userFlairAssignments'>;
export type CommunityProjectionWriter = Pick<RedditMutationClient, 'setUserFlairTemplate'>;

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
  ) {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
      throw new Error('Community flair projection interval must be a positive integer');
    }
  }

  public async tick(now = Date.now()): Promise<CommunityProjectionTick> {
    if (now < this.nextAt) return { applied: 0, failed: 0, skipped: true };
    this.nextAt = now + this.intervalMs;

    const [raw, assignments] = await Promise.all([
      this.reputation.raw(),
      this.reader.userFlairAssignments(this.targetSubreddit),
    ]);
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
}
