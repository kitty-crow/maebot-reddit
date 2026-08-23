import type { RedditModerationCfg } from '../env.ts';
import type { ModerationClassifier } from '../mod/classifier.ts';
import type { PrivateResolutionClassifier } from '../mod/privateResolution.ts';
import type { ReputationStore } from '../reputation/store.ts';
import type { RedditReadClient } from '../reddit/client.ts';
import { safeError } from '../reddit/error.ts';
import type { RedditMutationClient } from '../reddit/mutate.ts';
import { ModmailReplyOutbox } from './outbox.ts';
import { ModmailStore } from './store.ts';

export type ModmailReader = Pick<RedditReadClient, 'modmailConversations' | 'modmailConversation'>;
export type ModmailWriter = Pick<RedditMutationClient, 'replyModmail'>;

export type ModmailRuntimeTick = {
  readonly relayed: number;
  readonly audited: number;
  readonly apologies: number;
  readonly repliesApplied: number;
  readonly failed: number;
};

export class ModmailRuntime {
  public constructor(
    private readonly subreddit: string,
    _cfg: RedditModerationCfg,
    private readonly reader: ModmailReader,
    private readonly writer: ModmailWriter,
    _reputation: ReputationStore,
    private readonly store: ModmailStore,
    _classifier: ModerationClassifier | null = null,
    _resolution: PrivateResolutionClassifier | null = null,
    private readonly outbox: ModmailReplyOutbox | null = null,
  ) {}

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
        await this.store.sync([after]);
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
    const page = await this.reader.modmailConversations(this.subreddit, 100);
    const events = await this.store.sync(page.conversations);
    const replies = await this.applyReplies();
    return {
      relayed: events.length,
      audited: 0,
      apologies: 0,
      repliesApplied: replies.applied,
      failed: replies.failed,
    };
  }
}