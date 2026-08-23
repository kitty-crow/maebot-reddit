import type { RedditReadClient } from '../reddit/client.ts';
import { moderationExemption, moderatorSet, type ModerationExemption } from './exemption.ts';

export type ModerationPrivilegeReader = Pick<RedditReadClient, 'me' | 'moderators'>;

export type ModerationPrivilegeSnapshot = {
  readonly botUsername: string;
  readonly moderators: ReadonlySet<string>;
};

export type ModerationPrivilegeSource = {
  exemption(author: string | null): Promise<ModerationExemption>;
};

export class ModerationPrivileges implements ModerationPrivilegeSource {
  private snapshot: ModerationPrivilegeSnapshot | null = null;
  private validUntil = 0;

  public constructor(
    private readonly subreddit: string,
    private readonly reader: ModerationPrivilegeReader,
    private readonly ttlMs = 5 * 60_000,
  ) {
    if (subreddit.trim().length === 0) throw new Error('Moderation privilege subreddit is required');
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 0) throw new Error('Moderation privilege TTL must be a non-negative safe integer');
  }

  private async current(): Promise<ModerationPrivilegeSnapshot> {
    const now = Date.now();
    if (this.snapshot !== null && now < this.validUntil) return this.snapshot;
    const [me, moderators] = await Promise.all([
      this.reader.me(),
      this.reader.moderators(this.subreddit),
    ]);
    this.snapshot = {
      botUsername: me.name,
      moderators: moderatorSet(moderators.map(value => value.name)),
    };
    this.validUntil = now + this.ttlMs;
    return this.snapshot;
  }

  public async exemption(author: string | null): Promise<ModerationExemption> {
    const privileges = await this.current();
    return moderationExemption(author, privileges.botUsername, privileges.moderators);
  }

  public invalidate(): void {
    this.validUntil = 0;
  }
}