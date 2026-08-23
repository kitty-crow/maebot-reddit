import type { RedditModerationCfg } from '../env.ts';
import {
  RedditModerationClassifier,
  type ModerationClassifier,
} from '../mod/classifier.ts';
import {
  RedditPrivateResolutionClassifier,
  type PrivateResolutionClassifier,
} from '../mod/privateResolution.ts';
import { moderationHistoryFor } from '../reputation/moderationHistory.ts';
import type { ReputationStore } from '../reputation/store.ts';
import type { RedditReadClient } from '../reddit/client.ts';
import { safeError } from '../reddit/error.ts';
import type { RedditMutationClient } from '../reddit/mutate.ts';
import { ModmailReplyOutbox } from './outbox.ts';
import type { ModmailRelayEvent } from './store.ts';
import { ModmailStore } from './store.ts';

export type ModmailReader = Pick<RedditReadClient, 'modmailConversations' | 'modmailConversation'>;
export type ModmailWriter = Pick<RedditMutationClient, 'unmuteModmail' | 'replyModmail'>;

export type ModmailRuntimeTick = {
  readonly relayed: number;
  readonly audited: number;
  readonly apologies: number;
  readonly repliesApplied: number;
  readonly failed: number;
};

const contributionKey = (event: ModmailRelayEvent): string =>
  `modmail:${event.conversationId}:${event.messageId}`;

const permalinkFor = (conversationId: string): string =>
  `https://mod.reddit.com/mail/all/${encodeURIComponent(conversationId)}`;

const fromParticipant = (event: ModmailRelayEvent): boolean => {
  if (event.author === null || event.participant === null) return false;
  if (event.author.toLowerCase() !== event.participant.toLowerCase()) return false;
  return event.participatingAs === null || event.participatingAs === 'participant_user';
};

export class ModmailRuntime {
  private readonly classifier: ModerationClassifier;
  private readonly resolution: PrivateResolutionClassifier;

  public constructor(
    private readonly subreddit: string,
    cfg: RedditModerationCfg,
    private readonly reader: ModmailReader,
    private readonly writer: ModmailWriter,
    private readonly reputation: ReputationStore,
    private readonly store: ModmailStore,
    classifier: ModerationClassifier | null = null,
    resolution: PrivateResolutionClassifier | null = null,
    private readonly outbox: ModmailReplyOutbox | null = null,
  ) {
    this.classifier = classifier ?? new RedditModerationClassifier(cfg.ai);
    this.resolution = resolution ?? new RedditPrivateResolutionClassifier(cfg.ai);
  }

  private async audit(event: ModmailRelayEvent): Promise<'audited' | 'apology' | 'ignored'> {
    if (!fromParticipant(event) || event.author === null) return 'ignored';
    const key = contributionKey(event);
    if (await this.reputation.hasContribution(key)) return 'ignored';
    const prior = await this.reputation.user(event.author);
    const history = moderationHistoryFor(await this.reputation.raw(), event.author);
    const classification = await this.classifier.classify({
      kind: 'modmail',
      subreddit: this.subreddit,
      author: event.author,
      title: event.subject,
      text: event.bodyMarkdown,
      permalink: permalinkFor(event.conversationId),
      mediaUrls: [],
      history,
    });
    await this.reputation.applyModeration({
      fullname: key,
      kind: 'modmail',
      author: event.author,
      createdAt: event.createdAt,
      score: 0,
      permalink: permalinkFor(event.conversationId),
      content: event.bodyMarkdown,
      classification,
      moderatedAt: Math.floor(Date.now() / 1_000),
    });

    if (classification.verdict !== 'clean' || (prior?.points ?? 0) >= 1) return 'audited';
    const resolution = await this.resolution.classify(event.bodyMarkdown);
    if (!resolution.genuineApology) return 'audited';
    const cleared = await this.reputation.clearMuteForConstructiveResolution(
      event.author,
      Math.floor(Date.now() / 1_000),
    );
    if (!cleared) return 'audited';
    await this.writer.unmuteModmail(event.conversationId);
    return 'apology';
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
        await this.store.sync([after]);
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
    let audited = 0;
    let apologies = 0;
    let failed = 0;
    for (const event of events) {
      try {
        const result = await this.audit(event);
        if (result === 'audited') audited += 1;
        if (result === 'apology') {
          audited += 1;
          apologies += 1;
        }
      } catch (error) {
        failed += 1;
        console.error(`[Reddit modmail] ${event.key} failed: ${safeError(error)}`);
      }
    }
    const replies = await this.applyReplies();
    return {
      relayed: events.length,
      audited,
      apologies,
      repliesApplied: replies.applied,
      failed: failed + replies.failed,
    };
  }
}
