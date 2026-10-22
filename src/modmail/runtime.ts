import type { RedditReadClient } from '../reddit/client.ts';
import { safeError } from '../reddit/error.ts';
import type { RedditMutationClient } from '../reddit/mutate.ts';
import { ModmailReplyOutbox, type ModmailReplyIntent } from './outbox.ts';
import { ModmailStore } from './store.ts';

export type ModmailReader = Pick<RedditReadClient, 'modmailConversations' | 'modmailConversation'>;
export type ModmailWriter = Pick<RedditMutationClient, 'replyModmail'>;

export type ModmailRuntimeTick = {
  readonly relayed: number;
  readonly repliesApplied: number;
  readonly failed: number;
};

const communities = (value: string | readonly string[]): readonly string[] => {
  const input = typeof value === 'string' ? [value] : [...value];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const subreddit = raw.trim();
    if (subreddit.length === 0) throw new Error('Modmail subreddit name cannot be empty');
    const key = subreddit.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(subreddit);
  }
  if (out.length === 0) throw new Error('Modmail runtime requires at least one subreddit');
  return out;
};

export class ModmailRuntime {
  private readonly subreddits: readonly string[];
  private deliveryTail: Promise<void> = Promise.resolve();

  public constructor(
    subreddits: string | readonly string[],
    private readonly reader: ModmailReader,
    private readonly writer: ModmailWriter,
    private readonly store: ModmailStore,
    private readonly outbox: ModmailReplyOutbox | null = null,
  ) {
    this.subreddits = communities(subreddits);
    if (this.outbox !== null) {
      this.store.subscribe(async conversationIds => {
        for (const id of conversationIds) {
          const conversation = await this.store.conversation(id);
          if (conversation?.state !== 'archived') continue;
          const count = await this.outbox?.cancelPendingForConversation(id, 'conversation archived before delivery') ?? 0;
          if (count > 0) {
            console.warn(`[Reddit modmail] cancelled ${count} queued repl${count === 1 ? 'y' : 'ies'} for archived conversation ${id}.`);
          }
        }
      });
    }
  }

  /**
   * Serialize outbound sends across the timer and authenticated HTTP requests.
   * Reddit cannot deduplicate POST requests by our local key, so checking remote
   * history and posting must never race for the same reply.
   */
  private async withDeliveryLock<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.deliveryTail.then(operation, operation);
    this.deliveryTail = pending.then(() => undefined, () => undefined);
    return await pending;
  }

  /**
   * Send a single persisted reply immediately. A successful Reddit mutation is
   * recorded before refreshing the local transcript, so a failed follow-up read
   * cannot cause the moderator's reply to be posted twice.
   */
  private async applyReply(reply: ModmailReplyIntent, outbox: ModmailReplyOutbox): Promise<boolean> {
    try {
      const before = await this.reader.modmailConversation(reply.conversationId, false);
      if (before.state === 'archived') {
        if (await outbox.cancel(reply.key, 'conversation archived before delivery')) {
          console.warn(`[Reddit modmail] outbound reply ${reply.key} cancelled because conversation ${reply.conversationId} is archived.`);
        }
        return false;
      }
      const alreadyPresent = before.messages.some(message =>
        message.bodyMarkdown.trim() === reply.bodyMarkdown
        && message.createdAt >= Math.max(0, reply.createdAt - 60)
        && (message.participatingAs === 'moderator' || message.author?.isModerator === true));
      if (!alreadyPresent) await this.writer.replyModmail(reply.conversationId, reply.bodyMarkdown);
      await outbox.markApplied(reply.key);
      try {
        const after = alreadyPresent ? before : await this.reader.modmailConversation(reply.conversationId, false);
        await this.store.sync([after], Math.floor(Date.now() / 1_000), this.subreddits);
        await this.store.markReplyOrigin(
          reply.conversationId,
          reply.bodyMarkdown,
          reply.moderator.platform,
          reply.createdAt,
        );
      } catch (error) {
        console.error(`[Reddit modmail] reply ${reply.key} delivered, but transcript refresh failed: ${safeError(error)}`);
      }
      return true;
    } catch (error) {
      const safe = safeError(error);
      await outbox.markFailed(reply.key, safe);
      console.error(`[Reddit modmail] outbound reply ${reply.key} failed: ${safe}`);
      return false;
    }
  }

  /**
   * Called by the authenticated HTTP reply endpoint, rather than a timer.
   * Pending replies for the same conversation run in durable creation order.
   * An idempotent retry of an applied key confirms delivery without re-posting.
   */
  public async deliverReply(key: string): Promise<boolean> {
    const outbox = this.outbox;
    if (outbox === null) return false;
    return await this.withDeliveryLock(async () => {
      const target = await outbox.get(key);
      if (target === null || target.cancelledAt !== null) return false;
      if (target.appliedAt !== null) return true;
      const pending = await outbox.pending();
      for (const reply of pending) {
        if (reply.conversationId !== target.conversationId) continue;
        if (!(await this.applyReply(reply, outbox))) return false;
        if (reply.key === key) return true;
      }
      const status = await outbox.get(key);
      return status !== null && status.appliedAt !== null;
    });
  }

  /** Periodic recovery is kept only for previously failed or orphaned sends. */
  private async applyReplies(): Promise<{ readonly applied: number; readonly failed: number }> {
    const outbox = this.outbox;
    if (outbox === null) return { applied: 0, failed: 0 };
    return await this.withDeliveryLock(async () => {
      let applied = 0;
      let failed = 0;
      for (const reply of await outbox.pending()) {
        if (await this.applyReply(reply, outbox)) applied += 1;
        else failed += 1;
      }
      return { applied, failed };
    });
  }

  public async tick(): Promise<ModmailRuntimeTick> {
    // Recover outbound replies before slower incoming Modmail inventory reads.
    const replies = await this.applyReplies();
    const pages = await Promise.all(
      this.subreddits.map(async subreddit => await this.reader.modmailConversations(subreddit, 100)),
    );
    const conversations = pages
      .flatMap(page => page.conversations)
      .sort((left, right) => left.lastUpdatedAt - right.lastUpdatedAt || left.id.localeCompare(right.id));
    const events = await this.store.sync(
      conversations,
      Math.floor(Date.now() / 1_000),
      this.subreddits,
    );
    return {
      relayed: events.length,
      repliesApplied: replies.applied,
      failed: replies.failed,
    };
  }
}
