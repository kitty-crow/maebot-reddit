import type { RedditCfg } from '../env.ts';
import { RedditReadClient } from '../reddit/client.ts';
import { RedditMutationClient } from '../reddit/mutate.ts';
import type { DailyReviewApi, CanonicalWeeklyReview } from '../review/client.ts';
import { RedditStateStore } from '../store/state.ts';
import { MAJOR_ANNOUNCEMENT_FLAIR } from '../twitter/flair.ts';

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
      if (await this.alreadyComplete(review)) continue;
      inspected += 1;
      try {
        const primary = await this.publishPrimary(review);
        if (primary === null) {
          failed += 1;
          continue;
        }
        if (!this.singleTarget && !await this.publishLegacy(review, primary)) {
          failed += 1;
          continue;
        }
        completed += 1;
      } catch (error) {
        failed += 1;
        console.error(`[Reddit weekly Daily Task] relay failed for ${review.key}: ${safeMessage(error)}`);
      }
    }
    return { inspected, completed, failed };
  }

  private async alreadyComplete(review: CanonicalWeeklyReview): Promise<boolean> {
    const primary = await this.state.action(actionKey(review, 'primary'));
    if (primary?.state !== 'applied' || primary.externalId === null) return false;
    if (this.singleTarget) return true;
    const legacy = await this.state.action(actionKey(review, 'legacy'));
    return legacy?.state === 'applied' && legacy.externalId !== null;
  }

  private async publishPrimary(review: CanonicalWeeklyReview): Promise<string | null> {
    const key = actionKey(review, 'primary');
    const existing = await this.state.ensureAction({
      key,
      kind: 'post',
      target: 'weekly-daily:primary',
      reason: `Approved weekly Daily Task for ${review.weekStart}`,
      policy: 'weekly-daily-v1',
      createdAt: review.decision.at,
      actor: 'mae-weekly',
      oldState: null,
      newState: {
        reviewKey: review.key,
        weekStart: review.weekStart,
        media: review.media?.kind ?? '',
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

  private async publishLegacy(review: CanonicalWeeklyReview, primaryPostId: string): Promise<boolean> {
    const key = actionKey(review, 'legacy');
    const existing = await this.state.ensureAction({
      key,
      kind: 'crosspost',
      target: 'weekly-daily:legacy',
      reason: `Mirror approved weekly Daily Task for ${review.weekStart}`,
      policy: 'weekly-daily-v1',
      createdAt: review.decision.at,
      actor: 'mae-weekly',
      oldState: null,
      newState: {
        reviewKey: review.key,
        weekStart: review.weekStart,
        primaryPostId,
      },
      reviewKey: review.key,
    });
    if (existing.state === 'applied') return true;
    if (await this.state.beginAction(key) === null) return false;

    try {
      const post = await this.publisher.publishLegacy(review, primaryPostId);
      if (post.postId.length === 0) throw new Error('Weekly Reddit publisher returned an empty legacy post ID');
      await this.state.markActionApplied(key, post.postId, this.now());
      return true;
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

  private async flairId(subreddit: string): Promise<string> {
    const key = subreddit.toLowerCase();
    const cached = this.flairIds.get(key);
    if (cached !== undefined) return cached;

    const matches = (await this.read.postFlairTemplates(subreddit))
      .filter(template => template.text === MAJOR_ANNOUNCEMENT_FLAIR);
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one post flair ${JSON.stringify(MAJOR_ANNOUNCEMENT_FLAIR)} in r/${subreddit}, found ${matches.length}`);
    }
    const match = matches[0];
    if (match === undefined) throw new Error(`Resolved post flair ${JSON.stringify(MAJOR_ANNOUNCEMENT_FLAIR)} disappeared in r/${subreddit}`);
    this.flairIds.set(key, match.id);
    return match.id;
  }
}
