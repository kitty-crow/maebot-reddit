import type { RedditReadClient } from '../reddit/client.ts';
import { safeError } from '../reddit/error.ts';
import type { RedditMutationClient } from '../reddit/mutate.ts';
import { ModmailReplyOutbox } from './outbox.ts';
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

  public constructor(
    subreddits: string | readonly string[],
    private readonly reader: ModmailReader,
    private readonly writer: ModmailWriter,
    private readonly store: ModmailStore,
    private readonly outbox: ModmailReplyOutbox | null = null,
  ) {
    this.subreddits = communities(subreddits);
  }

  private async applyReplies(): Promise<{ readonly applied: number; readonly failed: number }> {
    if (this.outbox === null) return { applied: 0, failed: 0 };
    let applied = 0;
    let failed = 0;
    for (const reply of await this.outbox.pending()) {
      try {
        const before = await this.reader.modmailConversation(reply.conversationId, false);
        const alreadyPresent = before.messages.some(message =>
          message.bodyMarkdown.trim() === reply.bodyMarkdown
          && message.createdAt >= Math.max(0, reply.createdAt - 60)
          && (message.participatingAs === 'moderator' || message.author?.isModerator === true));
        if (!alreadyPresent) await this.writer.replyModmail(reply.conversationId, reply.bodyMarkdown);
        await this.outbox.markApplied(reply.key);
        const after = alreadyPresent ? before : await this.reader.modmailConversation(reply.conversationId, false);
        await this.store.sync([after], Math.floor(Date.now() / 1_000), this.subreddits);
        await this.store.markReplyOrigin(
          reply.conversationId,
          reply.bodyMarkdown,
          reply.moderator.platform,
          reply.createdAt,
        );
        applied += 1;
      } catch (error) {
        failed += 1;
        const safe = safeError(error);
        await this.outbox.markFailed(reply.key, safe);
        console.error(`[Reddit modmail] outbound reply ${reply.key} failed: ${safe}`);
      }
    }
    return { applied, failed };
  }

  public async tick(): Promise<ModmailRuntimeTick> {
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
    const replies = await this.applyReplies();
    return {
      relayed: events.length,
      repliesApplied: replies.applied,
      failed: replies.failed,
    };
  }
}
