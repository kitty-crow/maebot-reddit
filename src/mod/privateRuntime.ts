import type {
  ConversationModerationClassifier,
  ModerationAiCfg,
  ModerationClassifier,
} from './classifier.ts';
import { RedditModerationClassifier } from './classifier.ts';
import type { PrivateResolutionClassifier } from './privateResolution.ts';
import { RedditPrivateResolutionClassifier } from './privateResolution.ts';
import type { ReputationStore } from '../reputation/store.ts';
import { moderationHistoryFor } from '../reputation/moderationHistory.ts';
import type { ModmailConversation, ModmailMessage } from '../modmail/types.ts';
import type { ModmailRelayEvent, ModmailStore } from '../modmail/store.ts';
import { ModmailAuditStore } from '../modmail/auditStore.ts';
import { safeError } from '../reddit/error.ts';

export type PrivateModerationReputation = Pick<
  ReputationStore,
  'user' | 'hasContribution' | 'applyModeration' | 'clearMuteForConstructiveResolution' | 'raw'
>;

export type PrivateModerationClassifierFactory = (
  conversationId: string | undefined,
) => ConversationModerationClassifier;

export type PrivateModmailTick = {
  readonly inspected: number;
  readonly audited: number;
  readonly apologies: number;
  readonly skipped: number;
  readonly failed: number;
};

const sameUser = (left: string | null, right: string | null): boolean =>
  left !== null && right !== null && left.trim().toLowerCase() === right.trim().toLowerCase();

const participantMessage = (event: ModmailRelayEvent): boolean =>
  !event.isInternal && sameUser(event.author, event.participant);

const messageRole = (conversation: ModmailConversation, message: ModmailMessage): string => {
  if (message.isInternal) return 'moderator-internal';
  if (sameUser(message.author?.name ?? null, conversation.participant?.name ?? null)) return 'participant';
  if (message.author?.isModerator === true || message.participatingAs?.includes('moderator') === true) return 'moderator';
  if (message.author?.isAdmin === true) return 'reddit-admin';
  return 'other';
};

const contextFor = (conversation: ModmailConversation, target: ModmailRelayEvent): string => {
  const targetIndex = conversation.messages.findIndex(message => message.id === target.messageId);
  const throughTarget = targetIndex < 0
    ? conversation.messages
    : conversation.messages.slice(0, targetIndex + 1);
  const recent = throughTarget.slice(-30).map(message => ({
    id: message.id,
    at: message.createdAt,
    role: messageRole(conversation, message),
    author: message.author?.name ?? null,
    text: message.bodyMarkdown.slice(0, 8_000),
  }));
  return JSON.stringify({
    targetMessageId: target.messageId,
    targetText: target.bodyMarkdown,
    conversation: recent,
  });
};

export class PrivateModmailRuntime {
  private readonly classifierFactory: PrivateModerationClassifierFactory;
  private readonly resolution: PrivateResolutionClassifier;

  public constructor(
    private readonly cfg: ModerationAiCfg,
    private readonly relay: ModmailStore,
    private readonly audit: ModmailAuditStore,
    private readonly reputation: PrivateModerationReputation,
    classifierFactory: PrivateModerationClassifierFactory | null = null,
    resolution: PrivateResolutionClassifier | null = null,
  ) {
    this.classifierFactory = classifierFactory ?? (conversationId => new RedditModerationClassifier(cfg, {
      conversation: true,
      conversationId,
    }));
    this.resolution = resolution ?? new RedditPrivateResolutionClassifier(cfg);
  }

  private async advance(event: ModmailRelayEvent, openaiConversationId: string | null): Promise<void> {
    await this.audit.advance(event.sequence, event.conversationId, event.messageId, openaiConversationId);
  }

  private async process(event: ModmailRelayEvent): Promise<'audited' | 'apology' | 'skipped'> {
    const auditState = await this.audit.conversation(event.conversationId);
    const openaiConversationId = auditState?.openaiConversationId ?? null;
    if (!participantMessage(event) || event.author === null) {
      await this.advance(event, openaiConversationId);
      return 'skipped';
    }

    const fullname = `modmail:${event.conversationId}:${event.messageId}`;
    if (await this.reputation.hasContribution(fullname)) {
      await this.advance(event, openaiConversationId);
      return 'skipped';
    }

    const before = await this.reputation.user(event.author);
    if (before?.status === 'moderator' || before?.immutableModeratorFlair === true) {
      await this.advance(event, openaiConversationId);
      return 'skipped';
    }

    const conversation = await this.relay.conversation(event.conversationId);
    if (conversation === null) throw new Error(`Missing canonical modmail conversation ${event.conversationId}`);
    const classifier: ModerationClassifier & { readonly conversationId?: string } = this.classifierFactory(
      openaiConversationId ?? undefined,
    );
    const history = moderationHistoryFor(await this.reputation.raw(), event.author);
    const classification = await classifier.classify({
      kind: 'modmail',
      subreddit: event.subreddit,
      author: event.author,
      title: event.subject,
      text: contextFor(conversation, event),
      permalink: '',
      mediaUrls: [],
      history,
    });
    const createdConversationId = classifier.conversationId ?? openaiConversationId;
    if (createdConversationId !== null && createdConversationId !== undefined) {
      await this.audit.rememberConversation(event.conversationId, createdConversationId);
    }

    const after = await this.reputation.applyModeration({
      fullname,
      kind: 'modmail',
      author: event.author,
      createdAt: event.createdAt,
      score: 0,
      permalink: '',
      content: event.bodyMarkdown,
      classification,
      moderatedAt: Math.floor(Date.now() / 1_000),
    });

    let apology = false;
    if (classification.verdict === 'clean' && before?.status === 'uncivil' && after.status === 'uncivil') {
      const resolution = await this.resolution.classify(contextFor(conversation, event));
      if (resolution.genuineApology) {
        apology = await this.reputation.clearMuteForConstructiveResolution(event.author, Math.floor(Date.now() / 1_000));
      }
    }

    await this.advance(event, createdConversationId ?? null);
    return apology ? 'apology' : 'audited';
  }

  public async tick(limit = 100): Promise<PrivateModmailTick> {
    const after = await this.audit.cursor();
    const page = await this.relay.eventsAfter(after, limit);
    let audited = 0;
    let apologies = 0;
    let skipped = 0;
    let failed = 0;

    for (const event of page.events) {
      try {
        const result = await this.process(event);
        if (result === 'audited') audited += 1;
        else if (result === 'apology') {
          audited += 1;
          apologies += 1;
        } else skipped += 1;
      } catch (error) {
        failed += 1;
        console.error(`[Reddit private moderation] modmail ${event.key} failed: ${safeError(error)}`);
        break;
      }
    }

    return {
      inspected: audited + skipped + failed,
      audited,
      apologies,
      skipped,
      failed,
    };
  }
}
