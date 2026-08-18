import type { Tweet, TwitterApi, TwitterItem } from '../../vendor/maebot-twitter/src/index.ts';
import type { DailyReviewApi } from '../review/client.ts';
import { RedditStateStore, type TwitterFanout } from '../store/state.ts';

export type RedditPrimaryPost = {
  readonly postId: string;
};

export type RedditLegacyPost = {
  readonly postId: string;
  readonly mode: 'crosspost' | 'fallback';
};

export type TwitterRedditPublisher = {
  publishPrimary(tweet: Tweet, worthy: boolean | null): Promise<RedditPrimaryPost>;
  publishLegacy(tweet: Tweet, primaryPostId: string, worthy: boolean | null): Promise<RedditLegacyPost>;
  pin(target: 'primary' | 'legacy', postId: string): Promise<void>;
};

export type TwitterBridgeResult = {
  readonly inspected: number;
  readonly completed: number;
  readonly failed: number;
};

const safeMessage = (error: Parameters<Console['error']>[number]): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

const receipt = (fanout: TwitterFanout): string | null => {
  const primary = fanout.primary.postId;
  const legacy = fanout.legacy.postId;
  return primary === null || legacy === null ? null : `reddit:${primary}:${legacy}`;
};

export class TwitterRedditBridge {
  public constructor(
    private readonly twitter: TwitterApi,
    private readonly state: RedditStateStore,
    private readonly reviews: DailyReviewApi,
    private readonly publisher: TwitterRedditPublisher,
    private readonly now: () => number = () => Math.floor(Date.now() / 1_000),
    private readonly singleTarget = false,
  ) {}

  public async deliverPending(): Promise<TwitterBridgeResult> {
    let inspected = 0;
    let completed = 0;
    let failed = 0;

    const recovered = await this.recoverAcknowledgements();
    completed += recovered.completed;
    failed += recovered.failed;

    for (const item of await this.twitter.pending('reddit')) {
      inspected += 1;
      try {
        const done = await this.deliver(item);
        if (done) completed += 1;
      } catch (error) {
        failed += 1;
        console.error(`[Reddit Twitter bridge] delivery failed for tweet ${item.tweet.id}: ${safeMessage(error)}`);
      }
    }
    return { inspected, completed, failed };
  }

  public async syncReviews(): Promise<TwitterBridgeResult> {
    let inspected = 0;
    let completed = 0;
    let failed = 0;

    for (const candidate of await this.state.twitterReviewCandidates()) {
      inspected += 1;
      try {
        if (candidate.reviewDecision === 'approve') {
          const pins = await this.applyPins(candidate);
          failed += pins.failed;
          if (pins.complete) completed += 1;
          continue;
        }

        const canonical = await this.twitter.item(candidate.tweetId);
        if (canonical === null) {
          failed += 1;
          continue;
        }
        const synced = await this.state.syncTwitterCanonical(
          candidate.tweetId,
          canonical.tweet.author.handle,
          canonical.worthy,
          canonical.reviewKey,
        );
        if (synced === null || canonical.worthy !== true) continue;

        const review = await this.reviews.twitter(canonical.tweet.author.handle, canonical.tweet.id);
        if (review === null || review.decision === null) continue;
        await this.state.attachTwitterReview(candidate.tweetId, review.key);
        const decided = await this.state.decideTwitterReview(candidate.tweetId, review.decision.choice);
        if (decided === null) continue;
        if (review.decision.choice === 'reject') {
          completed += 1;
          continue;
        }

        const pins = await this.applyPins(decided);
        failed += pins.failed;
        if (pins.complete) completed += 1;
      } catch (error) {
        failed += 1;
        console.error(`[Reddit Twitter bridge] review sync failed for tweet ${candidate.tweetId}: ${safeMessage(error)}`);
      }
    }
    return { inspected, completed, failed };
  }

  private async deliver(item: TwitterItem): Promise<boolean> {
    const at = this.now();
    let fanout = await this.state.ensureTwitter(
      item.tweet.id,
      item.tweet.url,
      item.tweet.at,
      at,
      item.tweet.author.handle,
      item.worthy,
    );
    fanout = (await this.state.syncTwitterCanonical(
      item.tweet.id,
      item.tweet.author.handle,
      item.worthy,
      item.reviewKey,
    )) ?? fanout;

    if (fanout.primary.state !== 'applied') {
      try {
        const primary = await this.publisher.publishPrimary(item.tweet, item.worthy);
        if (primary.postId.length === 0) throw new Error('Primary Reddit publisher returned an empty post ID');
        fanout = (await this.state.markTwitterDelivery(item.tweet.id, 'primary', primary.postId, 'primary', this.now())) ?? fanout;
      } catch (error) {
        await this.state.markTwitterDeliveryFailed(item.tweet.id, 'primary', safeMessage(error), this.now());
        throw error;
      }
    }

    const primaryPostId = fanout.primary.postId;
    if (primaryPostId === null) throw new Error('Primary Reddit delivery is missing its post ID');

    if (fanout.legacy.state !== 'applied') {
      if (this.singleTarget) {
        fanout = (await this.state.markTwitterDelivery(item.tweet.id, 'legacy', primaryPostId, 'primary', this.now())) ?? fanout;
      } else {
        try {
          const legacy = await this.publisher.publishLegacy(item.tweet, primaryPostId, item.worthy);
          if (legacy.postId.length === 0) throw new Error('Legacy Reddit publisher returned an empty post ID');
          fanout = (await this.state.markTwitterDelivery(item.tweet.id, 'legacy', legacy.postId, legacy.mode, this.now())) ?? fanout;
        } catch (error) {
          await this.state.markTwitterDeliveryFailed(item.tweet.id, 'legacy', safeMessage(error), this.now());
          throw error;
        }
      }
    }

    if (fanout.lifecycle !== 'complete') return false;
    return await this.acknowledge(fanout);
  }

  private async recoverAcknowledgements(): Promise<{ readonly completed: number; readonly failed: number }> {
    let completed = 0;
    let failed = 0;
    for (const fanout of await this.state.unacknowledgedTwitter()) {
      try {
        const canonical = await this.twitter.item(fanout.tweetId);
        if (canonical?.redditDone === true) {
          await this.state.acknowledgeTwitter(fanout.tweetId);
          completed += 1;
          continue;
        }
        if (await this.acknowledge(fanout)) completed += 1;
      } catch (error) {
        failed += 1;
        console.error(`[Reddit Twitter bridge] acknowledgement recovery failed for tweet ${fanout.tweetId}: ${safeMessage(error)}`);
      }
    }
    return { completed, failed };
  }

  private async acknowledge(fanout: TwitterFanout): Promise<boolean> {
    if (fanout.acknowledged) return true;
    const value = receipt(fanout);
    if (value === null) return false;
    await this.twitter.markRelay('reddit', fanout.tweetId, value);
    await this.state.acknowledgeTwitter(fanout.tweetId);
    return true;
  }

  private async applyPins(fanout: TwitterFanout): Promise<{ readonly complete: boolean; readonly failed: number }> {
    let failed = 0;
    let current = fanout;

    if (this.singleTarget) {
      if (!current.primaryPinApplied && current.primary.postId !== null) {
        try {
          await this.publisher.pin('primary', current.primary.postId);
          current = (await this.state.markTwitterPin(current.tweetId, 'primary')) ?? current;
        } catch (error) {
          failed += 1;
          console.error(`[Reddit Twitter bridge] primary pin failed for tweet ${current.tweetId}: ${safeMessage(error)}`);
        }
      }
      if (current.primaryPinApplied && !current.legacyPinApplied) {
        current = (await this.state.markTwitterPin(current.tweetId, 'legacy')) ?? current;
      }
      return { complete: current.primaryPinApplied && current.legacyPinApplied, failed };
    }

    if (!current.primaryPinApplied && current.primary.postId !== null) {
      try {
        await this.publisher.pin('primary', current.primary.postId);
        current = (await this.state.markTwitterPin(current.tweetId, 'primary')) ?? current;
      } catch (error) {
        failed += 1;
        console.error(`[Reddit Twitter bridge] primary pin failed for tweet ${current.tweetId}: ${safeMessage(error)}`);
      }
    }

    if (!current.legacyPinApplied && current.legacy.postId !== null) {
      try {
        await this.publisher.pin('legacy', current.legacy.postId);
        current = (await this.state.markTwitterPin(current.tweetId, 'legacy')) ?? current;
      } catch (error) {
        failed += 1;
        console.error(`[Reddit Twitter bridge] legacy pin failed for tweet ${current.tweetId}: ${safeMessage(error)}`);
      }
    }

    return { complete: current.primaryPinApplied && current.legacyPinApplied, failed };
  }
}
