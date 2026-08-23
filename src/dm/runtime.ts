import type {
  ConversationModerationClassifier,
  ModerationAiCfg,
  ModerationClassification,
} from '../mod/classifier.ts';
import { RedditModerationClassifier } from '../mod/classifier.ts';
import type { ModerationPrivilegeSource } from '../mod/privileges.ts';
import type { PrivateResolutionClassifier } from '../mod/privateResolution.ts';
import { RedditPrivateResolutionClassifier } from '../mod/privateResolution.ts';
import { moderationHistoryFor } from '../reputation/moderationHistory.ts';
import type { ReputationStore } from '../reputation/store.ts';
import type { RedditReadClient } from '../reddit/client.ts';
import { safeError } from '../reddit/error.ts';
import type { RedditMutationClient } from '../reddit/mutate.ts';
import type { ConversationDmResponder, DmReplyDecision } from './reply.ts';
import { MaeRedditDmResponder } from './reply.ts';
import { DmStore } from './store.ts';
import type { DmMessageState, RedditDirectMessage } from './types.ts';

export type DmReader = Pick<
  RedditReadClient,
  'unreadDirectMessages' | 'directMessageHistory' | 'sentDirectMessages'
>;

export type DmWriter = Pick<
  RedditMutationClient,
  'replyToPrivateMessage' | 'markPrivateMessageRead'
>;

export type DmReputation = Pick<
  ReputationStore,
  'user' | 'hasContribution' | 'applyModeration' | 'clearMuteForConstructiveResolution' | 'raw'
>;

export type DmModerationFactory = (conversationId: string | undefined) => ConversationModerationClassifier;
export type DmReplyFactory = (conversationId: string | undefined) => ConversationDmResponder;

export type DmTick = {
  readonly inspected: number;
  readonly moderated: number;
  readonly replies: number;
  readonly noReply: number;
  readonly apologies: number;
  readonly recovered: number;
  readonly skipped: number;
  readonly uncertain: number;
  readonly failed: number;
};

const sameUser = (left: string | null, right: string): boolean =>
  left !== null && left.trim().toLowerCase() === right.trim().toLowerCase();

const incomingDirectMessage = (message: RedditDirectMessage, self: string): boolean =>
  !message.wasComment
  && message.author !== null
  && !sameUser(message.author, self)
  && (message.destination === null || sameUser(message.destination, self));

const threadFor = (message: RedditDirectMessage): string => {
  const root = message.firstMessageFullname;
  if (root !== null && /^t4_[A-Za-z0-9]+$/u.test(root)) return root;
  return message.fullname;
};

const contributionKey = (message: RedditDirectMessage): string => `dm:${message.fullname}`;

const exemptClassification = (): ModerationClassification => ({
  verdict: 'clean',
  rule: 'none',
  disposition: 'allow',
  penaltyPoints: 0,
  confidence: 1,
  reason: 'Moderator/private-message exemption resolved before reputation mutation.',
  evidence: [],
});

const sameReply = (sent: RedditDirectMessage, state: DmMessageState, self: string): boolean =>
  sameUser(sent.author, self)
  && sent.parentFullname === state.message.fullname
  && state.generatedReply !== null
  && sent.body.trim() === state.generatedReply.trim();

export class RedditDmRuntime {
  private readonly moderationFactory: DmModerationFactory;
  private readonly replyFactory: DmReplyFactory;
  private readonly resolution: PrivateResolutionClassifier;

  public constructor(
    private readonly subreddit: string,
    private readonly self: string,
    cfg: ModerationAiCfg,
    persona: string,
    private readonly reader: DmReader,
    private readonly writer: DmWriter,
    private readonly store: DmStore,
    private readonly reputation: DmReputation,
    private readonly privileges: ModerationPrivilegeSource | null = null,
    moderationFactory: DmModerationFactory | null = null,
    replyFactory: DmReplyFactory | null = null,
    resolution: PrivateResolutionClassifier | null = null,
  ) {
    this.moderationFactory = moderationFactory ?? (conversationId => new RedditModerationClassifier(cfg, {
      conversation: true,
      ...(conversationId === undefined ? {} : { conversationId }),
    }));
    this.replyFactory = replyFactory ?? (conversationId => new MaeRedditDmResponder(cfg, persona, conversationId));
    this.resolution = resolution ?? new RedditPrivateResolutionClassifier(cfg);
  }

  public async bootstrap(maxItems = 1000): Promise<number> {
    if (await this.store.hasBootstrap()) return 0;
    const history = await this.reader.directMessageHistory(maxItems);
    const incoming = history.filter(message => incomingDirectMessage(message, this.self));
    return await this.store.seed(incoming, Math.floor(Date.now() / 1_000));
  }

  private async recoverAttempted(): Promise<{ readonly recovered: number; readonly uncertain: number }> {
    const attempted = await this.store.attempted();
    if (attempted.length === 0) return { recovered: 0, uncertain: 0 };
    const sent = await this.reader.sentDirectMessages(1000);
    let recovered = 0;
    let uncertain = 0;
    for (const state of attempted) {
      if (sent.some(message => sameReply(message, state, this.self))) {
        await this.store.markSent(state.message.fullname, Math.floor(Date.now() / 1_000));
        await this.writer.markPrivateMessageRead(state.message.fullname);
        recovered += 1;
      } else {
        uncertain += 1;
        console.error(`[Reddit DM] delivery remains uncertain for ${state.message.fullname}; automatic resend is blocked`);
      }
    }
    return { recovered, uncertain };
  }

  private async exempt(username: string): Promise<boolean> {
    if (sameUser(username, this.self)) return true;
    if (this.privileges !== null && await this.privileges.exemption(username) !== null) return true;
    const current = await this.reputation.user(username);
    return current?.status === 'moderator' || current?.immutableModeratorFlair === true;
  }

  private async classification(
    state: DmMessageState,
    username: string,
    thread: string,
  ): Promise<{ readonly state: DmMessageState; readonly apology: boolean; readonly moderated: boolean }> {
    let current = state;
    const conversation = await this.store.conversation(thread, username);
    const isExempt = await this.exempt(username);

    if (current.classification === null) {
      if (isExempt) {
        current = await this.store.setClassification(current.message.fullname, exemptClassification());
      } else {
        const classifier = this.moderationFactory(conversation.moderationConversationId ?? undefined);
        const user = await this.reputation.user(username);
        const history = moderationHistoryFor(await this.reputation.raw(), username);
        const result = await classifier.classify({
          kind: 'dm',
          subreddit: this.subreddit,
          author: username,
          title: current.message.subject,
          text: current.message.body,
          permalink: '',
          mediaUrls: [],
          history,
        });
        current = await this.store.setClassification(current.message.fullname, result);
        await this.store.rememberConversations(
          thread,
          username,
          classifier.conversationId ?? conversation.moderationConversationId,
          conversation.responseConversationId,
        );
        if (user?.status === 'moderator' || user?.immutableModeratorFlair === true) {
          throw new Error(`Moderator u/${username} reached Reddit DM reputation mutation boundary`);
        }
      }
    }

    if (current.classificationApplied) return { state: current, apology: false, moderated: false };
    if (current.classification === null) throw new Error(`Reddit DM ${current.message.fullname} has no persisted classification`);

    if (isExempt) {
      current = await this.store.markModerated(current.message.fullname);
      return { state: current, apology: false, moderated: false };
    }

    const before = await this.reputation.user(username);
    const key = contributionKey(current.message);
    let after = before;
    if (!(await this.reputation.hasContribution(key))) {
      after = await this.reputation.applyModeration({
        fullname: key,
        kind: 'dm',
        author: username,
        createdAt: current.message.createdUtc,
        score: 0,
        permalink: '',
        content: current.message.body,
        classification: current.classification,
        moderatedAt: Math.floor(Date.now() / 1_000),
      });
    }

    let apology = false;
    if (
      current.classification.verdict === 'clean'
      && before?.status === 'uncivil'
      && after?.status === 'uncivil'
    ) {
      const resolution = await this.resolution.classify(current.message.body);
      if (resolution.genuineApology) {
        apology = await this.reputation.clearMuteForConstructiveResolution(username, Math.floor(Date.now() / 1_000));
      }
    }

    current = await this.store.markModerated(current.message.fullname);
    return { state: current, apology, moderated: true };
  }

  private async decideReply(
    state: DmMessageState,
    username: string,
    thread: string,
  ): Promise<{ readonly state: DmMessageState; readonly decision: DmReplyDecision | null }> {
    if (state.generatedReply !== null) return { state, decision: { respond: true, text: state.generatedReply } };
    if (state.delivery === 'no-reply') return { state, decision: { respond: false, text: '' } };
    if (state.classification === null || !state.classificationApplied) {
      throw new Error(`Reddit DM ${state.message.fullname} reached reply generation before moderation completed`);
    }

    const reputation = await this.reputation.user(username);
    if (reputation?.status === 'banned' || reputation?.status === 'scam') {
      return {
        state: await this.store.markNoReply(state.message.fullname, Math.floor(Date.now() / 1_000)),
        decision: { respond: false, text: '' },
      };
    }

    const conversation = await this.store.conversation(thread, username);
    const responder = this.replyFactory(conversation.responseConversationId ?? undefined);
    const decision = await responder.reply({
      message: state.message,
      classification: state.classification,
      reputation: reputation === null ? null : { points: reputation.points, status: reputation.status },
    });

    if (!decision.respond) {
      const next = await this.store.markNoReply(state.message.fullname, Math.floor(Date.now() / 1_000));
      await this.store.rememberConversations(
        thread,
        username,
        conversation.moderationConversationId,
        responder.conversationId ?? conversation.responseConversationId,
      );
      return { state: next, decision };
    }

    const next = await this.store.setReply(state.message.fullname, decision.text);
    await this.store.rememberConversations(
      thread,
      username,
      conversation.moderationConversationId,
      responder.conversationId ?? conversation.responseConversationId,
    );
    return { state: next, decision };
  }

  private async process(message: RedditDirectMessage): Promise<{
    readonly moderated: boolean;
    readonly reply: boolean;
    readonly noReply: boolean;
    readonly apology: boolean;
    readonly skipped: boolean;
  }> {
    if (!incomingDirectMessage(message, this.self) || message.author === null) {
      return { moderated: false, reply: false, noReply: false, apology: false, skipped: true };
    }

    let state = await this.store.begin(message);
    if (state.delivery === 'seeded') {
      return { moderated: false, reply: false, noReply: false, apology: false, skipped: true };
    }
    if (state.delivery === 'sent' || state.delivery === 'no-reply') {
      await this.writer.markPrivateMessageRead(message.fullname);
      return { moderated: false, reply: false, noReply: state.delivery === 'no-reply', apology: false, skipped: true };
    }
    if (state.delivery === 'attempted') {
      return { moderated: false, reply: false, noReply: false, apology: false, skipped: true };
    }

    const username = message.author;
    const thread = threadFor(message);
    const moderated = await this.classification(state, username, thread);
    state = moderated.state;
    const reply = await this.decideReply(state, username, thread);
    state = reply.state;

    if (reply.decision?.respond !== true) {
      await this.writer.markPrivateMessageRead(message.fullname);
      return {
        moderated: moderated.moderated,
        reply: false,
        noReply: true,
        apology: moderated.apology,
        skipped: false,
      };
    }

    if (state.generatedReply === null) throw new Error(`Reddit DM ${message.fullname} lost its persisted reply`);
    await this.store.markAttempted(message.fullname);
    await this.writer.replyToPrivateMessage(message.fullname, state.generatedReply);
    await this.store.markSent(message.fullname, Math.floor(Date.now() / 1_000));
    await this.writer.markPrivateMessageRead(message.fullname);
    return {
      moderated: moderated.moderated,
      reply: true,
      noReply: false,
      apology: moderated.apology,
      skipped: false,
    };
  }

  public async tick(maxItems = 100): Promise<DmTick> {
    if (!(await this.store.hasBootstrap())) {
      throw new Error('Reddit DM runtime must establish its activation boundary before processing inbox messages');
    }

    const recovery = await this.recoverAttempted();
    const unread = (await this.reader.unreadDirectMessages(maxItems))
      .filter(message => incomingDirectMessage(message, this.self))
      .sort((left, right) => left.createdUtc - right.createdUtc || left.fullname.localeCompare(right.fullname));

    let moderated = 0;
    let replies = 0;
    let noReply = 0;
    let apologies = 0;
    let skipped = 0;
    let failed = 0;

    for (const message of unread) {
      try {
        const result = await this.process(message);
        if (result.moderated) moderated += 1;
        if (result.reply) replies += 1;
        if (result.noReply) noReply += 1;
        if (result.apology) apologies += 1;
        if (result.skipped) skipped += 1;
      } catch (error) {
        failed += 1;
        console.error(`[Reddit DM] ${message.fullname} failed: ${safeError(error)}`);
        break;
      }
    }

    return {
      inspected: unread.length,
      moderated,
      replies,
      noReply,
      apologies,
      recovered: recovery.recovered,
      skipped,
      uncertain: recovery.uncertain,
      failed,
    };
  }
}
