import type { RedditCfg } from '../env.ts';
import { RedditReadClient } from '../reddit/client.ts';
import { RedditMutationClient } from '../reddit/mutate.ts';
import { readStickySlots } from '../reddit/stickySlots.ts';
import type { DailyReviewApi, CanonicalWeeklyReview } from '../review/client.ts';
import { RedditStateStore } from '../store/state.ts';
import { planSticky } from '../twitter/sticky.ts';
import {
  WEEKLY_HIGHLIGHT_LABEL,
  WEEKLY_HIGHLIGHT_REMOVE_AFTER,
  WEEKLY_SUMMARY_FLAIR,
  weeklyHighlightExpiresAt,
} from './redditPolicy.ts';

export type WeeklyRedditPost = {
  readonly postId: string;
};

export type WeeklyRedditLegacyPost = {
  readonly postId: string;
  readonly mode: 'crosspost' | 'fallback';
};

export type WeeklyRedditPublisher = {
  publishPrimary(review: CanonicalWeeklyReview): Promise<WeeklyRedditPost>;
  publishLegacy(review: CanonicalWeeklyReview, primaryPostId: string): Promise<WeeklyRedditLegacyPost>;
  highlight(target: 'primary' | 'legacy', postId: string): Promise<void>;
  unhighlight(target: 'primary' | 'legacy', postId: string): Promise<void>;
};

export type WeeklyRelayResult = {
  readonly inspected: number;
  readonly completed: number;
  readonly failed: number;
};

const safeMessage = (error: Parameters<Console['error']>[number]): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

const actionKey = (review: CanonicalWeeklyReview, target: 'primary' | 'legacy'): string =>
  `weekly-daily:${review.weekStart}:${target}`;

const highlightActionKey = (
  review: CanonicalWeeklyReview,
  target: 'primary' | 'legacy',
  action: 'add' | 'remove',
): string => `weekly-daily:${review.weekStart}:${target}:highlight:${action}`;

const marker = (review: CanonicalWeeklyReview): string => `<!-- mae-weekly-daily:${review.key} -->`;
const title = (review: CanonicalWeeklyReview): string =>
  `Nya Community Weekly Daily Task · ${review.weekStart.replaceAll('-', '.')}`;

const body = (review: CanonicalWeeklyReview): string => `${review.markdown}\n\n${marker(review)}`;

const redditPostUrl = (subreddit: string, postId: string): string =>
  `https://www.reddit.com/r/${subreddit}/comments/${postId}`;

export class WeeklyRedditRelay {
  public constructor(
    private readonly reviews: DailyReviewApi,
    private readonly state: RedditStateStore,
    private readonly publisher: WeeklyRedditPublisher,
    private readonly singleTarget = false,
    private readonly now: () => number = () => Math.floor(Date.now() / 1_000),
  ) {}

  public async sync(): Promise<WeeklyRelayResult> {
    let inspected = 0;
    let completed = 0;
    let failed = 0;

    for (const review of await this.reviews.weekly()) {
      try {
        await this.expireHighlights(review);
        if (await this.alreadyComplete(review)) continue;
        inspected += 1;

        const primary = await this.publishPrimary(review);
        if (primary === null) {
          failed += 1;
          continue;
        }
        if (!this.expired(review) && !await this.highlight(review, 'primary', primary)) {
          failed += 1;
          continue;
        }

        if (!this.singleTarget) {
          const legacy = await this.publishLegacy(review, primary);
          if (legacy === null) {
            failed += 1;
            continue;
          }
          if (!this.expired(review) && !await this.highlight(review, 'legacy', legacy)) {
            failed += 1;
            continue;
          }
        }
        completed += 1;
      } catch (error) {
        failed += 1;
        console.error(`[Reddit weekly Daily Task] relay failed for ${review.key}: ${safeMessage(error)}`);
      }
    }
    return { inspected, completed, failed };
  }

  private expired(review: CanonicalWeeklyReview): boolean {
    return this.now() >= weeklyHighlightExpiresAt(review.weekStart);
  }

  private async alreadyComplete(review: CanonicalWeeklyReview): Promise<boolean> {
    const primary = await this.state.action(actionKey(review, 'primary'));
    if (primary?.state !== 'applied' || primary.externalId === null) return false;
    if (!this.singleTarget) {
      const legacy = await this.state.action(actionKey(review, 'legacy'));
      if (legacy?.state !== 'applied' || legacy.externalId === null) return false;
    }
    if (this.expired(review)) return true;

    const primaryHighlight = await this.state.action(highlightActionKey(review, 'primary', 'add'));
    if (primaryHighlight?.state !== 'applied') return false;
    if (this.singleTarget) return true;
    const legacyHighlight = await this.state.action(highlightActionKey(review, 'legacy', 'add'));
    return legacyHighlight?.state === 'applied';
  }

  private async publishPrimary(review: CanonicalWeeklyReview): Promise<string | null> {
    const key = actionKey(review, 'primary');
    const existing = await this.state.ensureAction({
      key,
      kind: 'post',
      target: 'weekly-daily:primary',
      reason: `Approved weekly Daily Task for ${review.weekStart}`,
      policy: 'weekly-daily-v2',
      createdAt: review.decision.at,
      actor: 'mae-weekly',
      oldState: null,
      newState: {
        reviewKey: review.key,
        weekStart: review.weekStart,
        media: review.media?.kind ?? '',
        flair: WEEKLY_SUMMARY_FLAIR,
      },
      reviewKey: review.key,
    });
    if (existing.state === 'applied') return existing.externalId;
    if (await this.state.beginAction(key) === null) return null;

    try {
      const post = await this.publisher.publishPrimary(review);
      if (post.postId.length === 0) throw new Error('Weekly Reddit publisher returned an empty primary post ID');
      await this.state.markActionApplied(key, post.postId, this.now());
      return post.postId;
    } catch (error) {
      await this.state.markActionFailed(key, safeMessage(error));
      throw error;
    }
  }

  private async publishLegacy(review: CanonicalWeeklyReview, primaryPostId: string): Promise<string | null> {
    const key = actionKey(review, 'legacy');
    const existing = await this.state.ensureAction({
      key,
      kind: 'crosspost',
      target: 'weekly-daily:legacy',
      reason: `Mirror approved weekly Daily Task for ${review.weekStart}`,
      policy: 'weekly-daily-v2',
      createdAt: review.decision.at,
      actor: 'mae-weekly',
      oldState: null,
      newState: {
        reviewKey: review.key,
        weekStart: review.weekStart,
        primaryPostId,
        flair: WEEKLY_SUMMARY_FLAIR,
      },
      reviewKey: review.key,
    });
    if (existing.state === 'applied') return existing.externalId;
    if (await this.state.beginAction(key) === null) return null;

    try {
      const post = await this.publisher.publishLegacy(review, primaryPostId);
      if (post.postId.length === 0) throw new Error('Weekly Reddit publisher returned an empty legacy post ID');
      await this.state.markActionApplied(key, post.postId, this.now());
      return post.postId;
    } catch (error) {
      await this.state.markActionFailed(key, safeMessage(error));
      throw error;
    }
  }

  private async highlight(
    review: CanonicalWeeklyReview,
    target: 'primary' | 'legacy',
    postId: string,
  ): Promise<boolean> {
    const key = highlightActionKey(review, target, 'add');
    const existing = await this.state.ensureAction({
      key,
      kind: 'sticky',
      target: `weekly-daily:${target}:highlight`,
      reason: `Highlight approved weekly Daily Task for ${review.weekStart}`,
      policy: 'weekly-daily-v2',
      createdAt: review.decision.at,
      actor: 'mae-weekly',
      oldState: null,
      newState: {
        postId,
        label: WEEKLY_HIGHLIGHT_LABEL,
        removeAfter: WEEKLY_HIGHLIGHT_REMOVE_AFTER,
        expiresAt: weeklyHighlightExpiresAt(review.weekStart),
      },
      reviewKey: review.key,
    });
    if (existing.state === 'applied') return true;
    if (await this.state.beginAction(key) === null) return false;

    try {
      await this.publisher.highlight(target, postId);
      await this.state.markActionApplied(key, postId, this.now());
      return true;
    } catch (error) {
      await this.state.markActionFailed(key, safeMessage(error));
      throw error;
    }
  }

  private async expireHighlights(review: CanonicalWeeklyReview): Promise<void> {
    if (!this.expired(review)) return;
    await this.expireHighlight(review, 'primary');
    if (!this.singleTarget) await this.expireHighlight(review, 'legacy');
  }

  private async expireHighlight(
    review: CanonicalWeeklyReview,
    target: 'primary' | 'legacy',
  ): Promise<void> {
    const highlighted = await this.state.action(highlightActionKey(review, target, 'add'));
    if (highlighted?.state !== 'applied' || highlighted.externalId === null) return;

    const key = highlightActionKey(review, target, 'remove');
    const existing = await this.state.ensureAction({
      key,
      kind: 'sticky',
      target: `weekly-daily:${target}:unhighlight`,
      reason: `Weekly Daily Task highlight expired for ${review.weekStart}`,
      policy: 'weekly-daily-v2',
      createdAt: weeklyHighlightExpiresAt(review.weekStart),
      actor: 'mae-weekly',
      oldState: {
        postId: highlighted.externalId,
        label: WEEKLY_HIGHLIGHT_LABEL,
      },
      newState: {
        postId: highlighted.externalId,
        highlighted: false,
      },
      reviewKey: review.key,
    });
    if (existing.state === 'applied') return;
    if (await this.state.beginAction(key) === null) return;

    try {
      await this.publisher.unhighlight(target, highlighted.externalId);
      await this.state.markActionApplied(key, highlighted.externalId, this.now());
    } catch (error) {
      await this.state.markActionFailed(key, safeMessage(error));
      throw error;
    }
  }
}

export class LiveWeeklyRedditPublisher implements WeeklyRedditPublisher {
  private readonly read: RedditReadClient;
  private readonly write: RedditMutationClient;
  private readonly flairIds = new Map<string, string>();

  public constructor(private readonly cfg: RedditCfg) {
    this.read = new RedditReadClient(cfg.auth);
    this.write = new RedditMutationClient(cfg.auth);
  }

  public async publishPrimary(review: CanonicalWeeklyReview): Promise<WeeklyRedditPost> {
    const stamp = marker(review);
    const existing = (await this.read.newPosts(this.cfg.primarySubreddit, 100))
      .find(post => post.selfText.includes(stamp));
    if (existing !== undefined) return { postId: existing.id };

    const flairId = await this.flairId(this.cfg.primarySubreddit);
    const created = await this.write.submitSelf(this.cfg.primarySubreddit, title(review), body(review), flairId);
    return { postId: created.id };
  }

  public async publishLegacy(
    review: CanonicalWeeklyReview,
    primaryPostId: string,
  ): Promise<WeeklyRedditLegacyPost> {
    const primaryFullname = primaryPostId.startsWith('t3_') ? primaryPostId : `t3_${primaryPostId}`;
    const primaryUrl = redditPostUrl(this.cfg.primarySubreddit, primaryPostId);
    const stamp = marker(review);
    const existing = (await this.read.newPosts(this.cfg.sourceSubreddit, 100)).find(post =>
      post.crosspostParent === primaryFullname
      || post.selfText.includes(stamp)
      || post.selfText.includes(`Primary Reddit post: ${primaryUrl}`));
    if (existing !== undefined) {
      return {
        postId: existing.id,
        mode: existing.crosspostParent === primaryFullname ? 'crosspost' : 'fallback',
      };
    }

    const flairId = await this.flairId(this.cfg.sourceSubreddit);
    try {
      const created = await this.write.crosspost(this.cfg.sourceSubreddit, primaryPostId, title(review), flairId);
      return { postId: created.id, mode: 'crosspost' };
    } catch (crosspostError) {
      console.error(`[Reddit weekly Daily Task] native crosspost failed; using self-post fallback: ${safeMessage(crosspostError)}`);
      const fallback = `${review.markdown}\n\nPrimary Reddit post: ${primaryUrl}\n\n${stamp}`;
      const created = await this.write.submitSelf(this.cfg.sourceSubreddit, title(review), fallback, flairId);
      return { postId: created.id, mode: 'fallback' };
    }
  }

  public async highlight(target: 'primary' | 'legacy', postId: string): Promise<void> {
    const subreddit = target === 'primary' ? this.cfg.primarySubreddit : this.cfg.sourceSubreddit;
    const slots = await readStickySlots(this.read, subreddit);
    const plan = planSticky(slots, postId);
    if (plan.action === 'already_sticky') return;
    if (plan.action === 'blocked') {
      throw new Error(`All four API-visible highlight slots in r/${subreddit} are occupied; refusing to evict an unrelated post`);
    }
    await this.write.sticky(postId, plan.slot);
  }

  public async unhighlight(_target: 'primary' | 'legacy', postId: string): Promise<void> {
    await this.write.unsticky(postId);
  }

  private async flairId(subreddit: string): Promise<string> {
    const key = subreddit.toLowerCase();
    const cached = this.flairIds.get(key);
    if (cached !== undefined) return cached;

    const matches = (await this.read.postFlairTemplates(subreddit))
      .filter(template => template.text === WEEKLY_SUMMARY_FLAIR);
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one post flair ${JSON.stringify(WEEKLY_SUMMARY_FLAIR)} in r/${subreddit}, found ${matches.length}`);
    }
    const match = matches[0];
    if (match === undefined) throw new Error(`Resolved post flair ${JSON.stringify(WEEKLY_SUMMARY_FLAIR)} disappeared in r/${subreddit}`);
    this.flairIds.set(key, match.id);
    return match.id;
  }
}
