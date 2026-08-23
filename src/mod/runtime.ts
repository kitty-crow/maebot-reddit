import type { RedditModerationCfg } from '../env.ts';
import { ReputationStore, type ReputationContributionKind } from '../reputation/store.ts';
import { RedditReadClient } from '../reddit/client.ts';
import { safeError } from '../reddit/error.ts';
import { RedditMutationClient } from '../reddit/mutate.ts';
import type { RedditComment, RedditPost } from '../reddit/types.ts';
import {
  RedditModerationClassifier,
  type ModerationClassifier,
  type ModerationItem,
} from './classifier.ts';
import { moderationExemption, moderatorSet } from './exemption.ts';

export type RedditModerationTick = {
  readonly discovered: number;
  readonly audited: number;
  readonly exempt: number;
  readonly scoreCredits: number;
  readonly effectsApplied: number;
  readonly failed: number;
};

type RuntimeItem = {
  readonly fullname: string;
  readonly kind: ReputationContributionKind;
  readonly author: string | null;
  readonly createdAt: number;
  readonly score: number;
  readonly moderation: ModerationItem;
};

type Privileges = {
  readonly botUsername: string;
  readonly moderators: ReadonlySet<string>;
};

const postItem = (post: RedditPost): RuntimeItem => ({
  fullname: post.fullname,
  kind: 'post',
  author: post.author,
  createdAt: post.createdUtc,
  score: post.score,
  moderation: {
    kind: 'post',
    subreddit: post.subreddit,
    author: post.author ?? '[deleted]',
    title: post.title,
    text: [post.selfText, post.url].filter(value => value.trim().length > 0).join('\n\n'),
    permalink: post.permalink,
    mediaUrls: post.mediaUrls,
  },
});

const commentItem = (comment: RedditComment): RuntimeItem => ({
  fullname: comment.fullname,
  kind: 'comment',
  author: comment.author,
  createdAt: comment.createdUtc,
  score: comment.score,
  moderation: {
    kind: 'comment',
    subreddit: comment.subreddit,
    author: comment.author ?? '[deleted]',
    title: '',
    text: comment.body,
    permalink: comment.permalink,
    mediaUrls: comment.mediaUrls,
  },
});

export class RedditModerationRuntime {
  private readonly classifier: ModerationClassifier;
  private privilegeCache: Privileges | null = null;
  private privilegeUntil = 0;

  public constructor(
    private readonly subreddit: string,
    private readonly cfg: RedditModerationCfg,
    private readonly reader: RedditReadClient,
    private readonly writer: RedditMutationClient,
    private readonly reputation: ReputationStore,
    classifier: ModerationClassifier | null = null,
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
    const classification = await this.classifier.classify(item.moderation);
    await this.reputation.applyModeration({
      fullname: item.fullname,
      kind: item.kind,
      author: item.author,
      createdAt: item.createdAt,
      score: item.score,
      classification,
      moderatedAt: Math.floor(Date.now() / 1_000),
    });
    return 'audited';
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
    const items = [
      ...posts.map(postItem),
      ...comments.map(commentItem),
    ].sort((a, b) => a.createdAt - b.createdAt || a.fullname.localeCompare(b.fullname));

    let audited = 0;
    let exempt = 0;
    let scoreCredits = 0;
    let failed = 0;
    for (const item of items) {
      try {
        const existed = await this.reputation.hasContribution(item.fullname);
        const result = await this.process(item, privileges);
        if (result === 'audited') audited += 1;
        if (result === 'exempt') exempt += 1;
        if (existed) {
          scoreCredits += await this.reputation.observeScore(
            item.fullname,
            item.score,
            Math.floor(Date.now() / 1_000),
          );
        }
      } catch (error) {
        failed += 1;
        console.error(`[Reddit moderation] ${item.fullname} failed: ${safeError(error)}`);
      }
    }
    const effects = await this.applyEffects();
    return {
      discovered: items.length,
      audited,
      exempt,
      scoreCredits,
      effectsApplied: effects.applied,
      failed: failed + effects.failed,
    };
  }
}
