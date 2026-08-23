import type { RedditModerationCfg } from '../env.ts';
import { authoritativeFlairRestores } from '../reputation/flairReconcile.ts';
import { scoreInventoryFullnames } from '../reputation/inventory.ts';
import { moderationHistoryFor } from '../reputation/moderationHistory.ts';
import {
  ReputationStore,
  type ReputationContributionKind,
  type ReputationVoteSuspicion,
} from '../reputation/store.ts';
import type { RedditReadClient } from '../reddit/client.ts';
import { safeError } from '../reddit/error.ts';
import type { RedditMutationClient } from '../reddit/mutate.ts';
import type { RedditComment, RedditPost } from '../reddit/types.ts';
import {
  RedditModerationClassifier,
  type ModerationClassifier,
  type ModerationItem,
} from './classifier.ts';
import { moderationExemption, moderatorSet } from './exemption.ts';
import type { ModerationReviewStore } from './review.ts';

export type ModerationReader = Pick<
  RedditReadClient,
  'me' | 'moderators' | 'newPosts' | 'newComments' | 'scores' | 'userFlairAssignments'
>;
export type ModerationWriter = Pick<
  RedditMutationClient,
  'setUserFlairTemplate' | 'remove' | 'banUser' | 'sendPrivateMessage' | 'muteUser' | 'unmuteUser'
>;

export type RedditModerationTick = {
  readonly discovered: number;
  readonly audited: number;
  readonly exempt: number;
  readonly scoreCredits: number;
  readonly voteReviews: number;
  readonly reviewActions: number;
  readonly flairRestored: number;
  readonly effectsApplied: number;
  readonly failed: number;
};

type RuntimeItem = {
  readonly fullname: string;
  readonly kind: ReputationContributionKind;
  readonly author: string | null;
  readonly createdAt: number;
  readonly score: number;
  readonly permalink: string;
  readonly content: string;
  readonly moderation: ModerationItem;
};

type Privileges = {
  readonly botUsername: string;
  readonly moderators: ReadonlySet<string>;
};

const postContent = (post: RedditPost): string =>
  [post.title, post.selfText, post.url].filter(value => value.trim().length > 0).join('\n\n');

const postItem = (post: RedditPost): RuntimeItem => ({
  fullname: post.fullname,
  kind: 'post',
  author: post.author,
  createdAt: post.createdUtc,
  score: post.score,
  permalink: post.permalink,
  content: postContent(post),
  moderation: {
    kind: 'post',
    subreddit: post.subreddit,
    author: post.author ?? '[deleted]',
    title: post.title,
    text: [post.selfText, post.url].filter(value => value.trim().length > 0).join('\n\n'),
    permalink: post.permalink,
    mediaUrls: post.mediaUrls,
    history: null,
  },
});

const commentItem = (comment: RedditComment): RuntimeItem => ({
  fullname: comment.fullname,
  kind: 'comment',
  author: comment.author,
  createdAt: comment.createdUtc,
  score: comment.score,
  permalink: comment.permalink,
  content: comment.body,
  moderation: {
    kind: 'comment',
    subreddit: comment.subreddit,
    author: comment.author ?? '[deleted]',
    title: '',
    text: comment.body,
    permalink: comment.permalink,
    mediaUrls: comment.mediaUrls,
    history: null,
  },
});

const voteReviewKey = (value: ReputationVoteSuspicion): string =>
  `vote-manipulation:${value.fullname}:${Math.max(0, Math.floor(value.score / 25))}`;

export class RedditModerationRuntime {
  private readonly classifier: ModerationClassifier;
  private privilegeCache: Privileges | null = null;
  private privilegeUntil = 0;
  private scoreCursor = 0;
  private nextFlairReconcileAt = 0;

  public constructor(
    private readonly subreddit: string,
    private readonly cfg: RedditModerationCfg,
    private readonly reader: ModerationReader,
    private readonly writer: ModerationWriter,
    private readonly reputation: ReputationStore,
    classifier: ModerationClassifier | null = null,
    private readonly reviews: ModerationReviewStore | null = null,
  ) {
    this.classifier = classifier ?? new RedditModerationClassifier(cfg.ai);
  }

  private async privileges(): Promise<Privileges> {
    const now = Date.now();
    if (this.privilegeCache !== null && now < this.privilegeUntil) return this.privilegeCache;
    const [me, moderators] = await Promise.all([
      this.reader.me(),
      this.reader.moderators(this.subreddit),
    ]);
    this.privilegeCache = {
      botUsername: me.name,
      moderators: moderatorSet(moderators.map(value => value.name)),
    };
    this.privilegeUntil = now + 5 * 60_000;
    return this.privilegeCache;
  }

  private async process(item: RuntimeItem, privileges: Privileges): Promise<'audited' | 'exempt' | 'seen'> {
    if (await this.reputation.hasContribution(item.fullname)) return 'seen';
    if (item.author === null) return 'seen';
    const exemption = moderationExemption(item.author, privileges.botUsername, privileges.moderators);
    if (exemption !== null) {
      await this.reputation.recordExempt(
        item.fullname,
        item.kind,
        item.author,
        item.createdAt,
        item.score,
        Math.floor(Date.now() / 1_000),
      );
      return 'exempt';
    }

    const history = moderationHistoryFor(await this.reputation.raw(), item.author);
    const classification = await this.classifier.classify({ ...item.moderation, history });
    await this.reputation.applyModeration({
      fullname: item.fullname,
      kind: item.kind,
      author: item.author,
      createdAt: item.createdAt,
      score: item.score,
      permalink: item.permalink,
      content: item.content,
      classification,
      moderatedAt: Math.floor(Date.now() / 1_000),
    });
    return 'audited';
  }

  private nextScoreBatch(fullnames: readonly string[]): readonly string[] {
    if (fullnames.length === 0) return [];
    const size = Math.min(this.cfg.scoreBatchSize, fullnames.length);
    const start = this.scoreCursor % fullnames.length;
    const out: string[] = [];
    for (let offset = 0; offset < size; offset += 1) {
      const index = (start + offset) % fullnames.length;
      const fullname = fullnames[index];
      if (fullname !== undefined) out.push(fullname);
    }
    this.scoreCursor = (start + size) % fullnames.length;
    return out;
  }

  private async createVoteReview(suspicion: ReputationVoteSuspicion, at: number): Promise<boolean> {
    if (this.reviews === null) return false;
    const key = voteReviewKey(suspicion);
    const existing = await this.reviews.get(key);
    if (existing !== null) return false;
    await this.reviews.create({
      key,
      targetKind: suspicion.kind === 'post' ? 'submission' : 'comment',
      targetId: suspicion.fullname,
      subreddit: this.subreddit,
      permalink: suspicion.permalink,
      author: suspicion.author,
      summary: `Suspicious Reddit vote growth detected for ${suspicion.fullname}. Confirm only if the pattern is consistent with vote manipulation; score trajectory alone is not proof.`,
      evidence: suspicion.evidence,
      recommendedAction: 'warn',
      reason: suspicion.reason,
      policy: 'reddit-vote-manipulation/v1',
      createdAt: at,
    });
    return true;
  }

  private async sampleScores(): Promise<{ readonly credits: number; readonly reviews: number }> {
    const at = Math.floor(Date.now() / 1_000);
    const inventory = scoreInventoryFullnames(await this.reputation.raw(), at);
    const batch = this.nextScoreBatch(inventory);
    if (batch.length === 0) return { credits: 0, reviews: 0 };
    const values = await this.reader.scores(batch);
    let credits = 0;
    let reviews = 0;
    for (const value of values) {
      const observed = await this.reputation.observeScoreSample(value.fullname, value.score, value.archived, at);
      credits += observed.awarded;
      if (observed.suspicion !== null && await this.createVoteReview(observed.suspicion, at)) reviews += 1;
    }
    return { credits, reviews };
  }

  private async applyReviewDecisions(): Promise<{ readonly applied: number; readonly failed: number }> {
    if (this.reviews === null) return { applied: 0, failed: 0 };
    let applied = 0;
    let failed = 0;
    for (const review of await this.reviews.needsApply()) {
      if (review.policy !== 'reddit-vote-manipulation/v1') continue;
      try {
        await this.reputation.attachVoteReview(review.targetId, review.key);
        const user = await this.reputation.confirmVoteManipulation(
          review.targetId,
          review.key,
          review.decision?.at ?? Math.floor(Date.now() / 1_000),
          `Moderator-confirmed vote manipulation. ${review.reason}`,
        );
        if (user === null) throw new Error(`Vote-manipulation target ${review.targetId} is no longer actionable`);
        await this.reviews.markApplied(review.key, `vote-manipulation:${review.targetId}`, Math.floor(Date.now() / 1_000));
        applied += 1;
      } catch (error) {
        failed += 1;
        await this.reviews.markFailed(review.key, safeError(error));
        console.error(`[Reddit reputation] vote-manipulation review ${review.key} failed: ${safeError(error)}`);
      }
    }
    return { applied, failed };
  }

  private async reconcileAuthoritativeFlairs(now: number): Promise<{ readonly restored: number; readonly failed: number }> {
    if (now < this.nextFlairReconcileAt) return { restored: 0, failed: 0 };
    this.nextFlairReconcileAt = now + this.cfg.flairReconcileMs;
    const assignments = await this.reader.userFlairAssignments(this.subreddit);
    const restores = authoritativeFlairRestores(await this.reputation.raw(), assignments);
    let restored = 0;
    let failed = 0;
    for (const flair of restores) {
      try {
        await this.writer.setUserFlairTemplate(this.subreddit, flair.username, flair.templateId, null);
        await this.reputation.markFlairApplied(flair.username, flair.templateId, flair.text);
        restored += 1;
        console.log(`[Reddit reputation] restored authoritative flair for u/${flair.username}.`);
      } catch (error) {
        failed += 1;
        console.error(`[Reddit reputation] authoritative flair restore failed for u/${flair.username}: ${safeError(error)}`);
      }
    }
    return { restored, failed };
  }

  private async applyEffects(): Promise<{ readonly applied: number; readonly failed: number }> {
    const effects = await this.reputation.pendingEffects();
    let applied = 0;
    let failed = 0;

    for (const flair of effects.flairs) {
      try {
        await this.writer.setUserFlairTemplate(this.subreddit, flair.username, flair.templateId, null);
        await this.reputation.markFlairApplied(flair.username, flair.templateId, flair.text);
        applied += 1;
      } catch (error) {
        failed += 1;
        console.error(`[Reddit moderation] flair apply failed for u/${flair.username}: ${safeError(error)}`);
      }
    }

    for (const removal of effects.removals) {
      try {
        await this.writer.remove(removal.fullname);
        await this.reputation.markRemovalApplied(removal.fullname);
        applied += 1;
      } catch (error) {
        failed += 1;
        console.error(`[Reddit moderation] removal failed for ${removal.fullname}: ${safeError(error)}`);
      }
    }

    for (const ban of effects.bans) {
      try {
        await this.writer.banUser(
          this.subreddit,
          ban.username,
          'Mae reputation enforcement',
          `Permanent Mae reputation floor reached from ${ban.fullname}.`,
        );
        await this.reputation.markBanApplied(ban.fullname);
        applied += 1;
      } catch (error) {
        failed += 1;
        console.error(`[Reddit moderation] ban failed for u/${ban.username}: ${safeError(error)}`);
      }
    }

    for (const mute of effects.mutes) {
      try {
        if (mute.action === 'mute') await this.writer.muteUser(this.subreddit, mute.username, mute.note);
        else await this.writer.unmuteUser(this.subreddit, mute.username);
        await this.reputation.markMuteApplied(mute.username, mute.action, Date.now());
        applied += 1;
      } catch (error) {
        failed += 1;
        console.error(`[Reddit moderation] ${mute.action} failed for u/${mute.username}: ${safeError(error)}`);
      }
    }

    for (const notice of effects.notices) {
      try {
        await this.writer.sendPrivateMessage(notice.username, notice.subject, notice.body);
        await this.reputation.markNoticeApplied(notice.key);
        applied += 1;
      } catch (error) {
        failed += 1;
        console.error(`[Reddit moderation] notice failed for u/${notice.username}: ${safeError(error)}`);
      }
    }
    return { applied, failed };
  }

  public async tick(): Promise<RedditModerationTick> {
    if (!(await this.reputation.hasBootstrap())) {
      throw new Error(`Reddit moderation requires a bootstrapped reputation store at ${this.cfg.stateFile}`);
    }
    const privileges = await this.privileges();
    const [posts, comments] = await Promise.all([
      this.reader.newPosts(this.subreddit, this.cfg.batchSize),
      this.reader.newComments(this.subreddit, this.cfg.batchSize),
    ]);
    const items = [...posts.map(postItem), ...comments.map(commentItem)]
      .sort((a, b) => a.createdAt - b.createdAt || a.fullname.localeCompare(b.fullname));

    let audited = 0;
    let exempt = 0;
    let failed = 0;
    for (const item of items) {
      try {
        const result = await this.process(item, privileges);
        if (result === 'audited') audited += 1;
        if (result === 'exempt') exempt += 1;
      } catch (error) {
        failed += 1;
        console.error(`[Reddit moderation] ${item.fullname} failed: ${safeError(error)}`);
      }
    }

    let scoreCredits = 0;
    let voteReviews = 0;
    try {
      const scores = await this.sampleScores();
      scoreCredits = scores.credits;
      voteReviews = scores.reviews;
    } catch (error) {
      failed += 1;
      console.error(`[Reddit reputation] score inventory sampling failed: ${safeError(error)}`);
    }

    const reviewActions = await this.applyReviewDecisions();

    let flairRestored = 0;
    let flairFailed = 0;
    try {
      const reconciliation = await this.reconcileAuthoritativeFlairs(Date.now());
      flairRestored = reconciliation.restored;
      flairFailed = reconciliation.failed;
    } catch (error) {
      flairFailed = 1;
      console.error(`[Reddit reputation] flair reconciliation failed: ${safeError(error)}`);
    }

    const effects = await this.applyEffects();
    return {
      discovered: items.length,
      audited,
      exempt,
      scoreCredits,
      voteReviews,
      reviewActions: reviewActions.applied,
      flairRestored,
      effectsApplied: effects.applied,
      failed: failed + effects.failed + flairFailed + reviewActions.failed,
    };
  }
}
