import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  DailyMedia,
  Tweet,
  TwitterApi,
  TwitterItem,
  TwitterPlatform,
} from '../vendor/maebot-twitter/src/index.ts';
import type { CanonicalDailyReview, CanonicalWeeklyReview, DailyReviewApi } from '../src/review/client.ts';
import { RedditStateStore } from '../src/store/state.ts';
import {
  TwitterRedditBridge,
  type RedditLegacyPost,
  type RedditPrimaryPost,
  type TwitterRedditPublisher,
} from '../src/twitter/bridge.ts';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const tweet = (id: string): Tweet => ({
  id,
  url: `https://twitter.com/NyaOnEarth/status/${id}`,
  text: `tweet ${id}`,
  at: 1_788_048_000,
  author: { name: 'Nya', handle: 'NyaOnEarth', avatar: null },
  photos: [],
  videos: [],
  quote: null,
  poll: null,
});

const item = (id: string): TwitterItem => ({
  tweet: tweet(id),
  worthy: true,
  telegramDone: true,
  telegramMessageId: 'tg',
  discordDone: true,
  discordMessageId: 'dc',
  redditDone: false,
  redditDeliveryId: null,
  reviewKey: `twitter:nyaonearth:${id}`,
  dailyDraft: null,
  dailyMedia: null,
});

class FakeTwitter implements TwitterApi {
  public constructor(public current: TwitterItem) {}

  public async pending(platform: TwitterPlatform): Promise<readonly TwitterItem[]> {
    return platform === 'reddit' && !this.current.redditDone ? [this.current] : [];
  }

  public async item(id: string): Promise<TwitterItem | null> {
    return id === this.current.tweet.id ? this.current : null;
  }

  public async worthyWithoutReview(): Promise<readonly TwitterItem[]> {
    return [];
  }

  public async markRelay(platform: TwitterPlatform, id: string, messageId: string): Promise<void> {
    if (platform !== 'reddit' || id !== this.current.tweet.id) throw new Error('unexpected relay');
    this.current = { ...this.current, redditDone: true, redditDeliveryId: messageId };
  }

  public async prepareDaily(): Promise<string> {
    throw new Error('not used');
  }

  public async cacheDailyMedia(_id: string, _media: DailyMedia): Promise<void> {
    throw new Error('not used');
  }

  public async attachReview(): Promise<void> {
    throw new Error('not used');
  }
}

class FakeReviews implements DailyReviewApi {
  public constructor(public value: CanonicalDailyReview | null) {}

  public async twitter(): Promise<CanonicalDailyReview | null> {
    return this.value;
  }

  public async weekly(): Promise<readonly CanonicalWeeklyReview[]> {
    return [];
  }
}

class FakePublisher implements TwitterRedditPublisher {
  public primaryMajor: boolean[] = [];
  public legacyMajor: boolean[] = [];

  public async publishPrimary(_tweet: Tweet, worthy: boolean | null): Promise<RedditPrimaryPost> {
    this.primaryMajor.push(worthy === true);
    return { postId: 'primary-post' };
  }

  public async publishLegacy(
    _tweet: Tweet,
    _primaryPostId: string,
    worthy: boolean | null,
  ): Promise<RedditLegacyPost> {
    this.legacyMajor.push(worthy === true);
    return { postId: 'legacy-post', mode: 'crosspost' };
  }

  public async pin(): Promise<void> {}
}

const state = async (): Promise<RedditStateStore> => {
  const root = await mkdtemp(join(tmpdir(), 'mae-reddit-twitter-daily-'));
  roots.push(root);
  return new RedditStateStore(join(root, 'reddit.pb'));
};

const review = (id: string, choice: 'approve' | 'reject'): CanonicalDailyReview => ({
  key: `twitter:nyaonearth:${id}`,
  account: 'NyaOnEarth',
  tweetId: id,
  decision: { choice, at: 300 },
  applied: choice === 'approve',
});

test('worthy tweet is not published to Reddit before moderator review', async () => {
  const current = item('2234567890');
  const twitter = new FakeTwitter(current);
  const publisher = new FakePublisher();
  const bridge = new TwitterRedditBridge(twitter, await state(), new FakeReviews(null), publisher, () => 200);

  expect(await bridge.deliverPending()).toEqual({ inspected: 1, completed: 0, failed: 0 });
  expect(publisher.primaryMajor).toEqual([]);
  expect(publisher.legacyMajor).toEqual([]);
  expect(twitter.current.redditDone).toBe(false);
});

test('approved worthy tweet publishes once as a major Reddit update', async () => {
  const current = item('2234567891');
  const twitter = new FakeTwitter(current);
  const publisher = new FakePublisher();
  const reviews = new FakeReviews(review(current.tweet.id, 'approve'));
  const bridge = new TwitterRedditBridge(twitter, await state(), reviews, publisher, () => 200);

  await bridge.deliverPending();
  expect(await bridge.syncReviews()).toEqual({ inspected: 1, completed: 1, failed: 0 });
  expect(await bridge.deliverPending()).toEqual({ inspected: 0, completed: 0, failed: 0 });
  expect(publisher.primaryMajor).toEqual([true]);
  expect(publisher.legacyMajor).toEqual([true]);
  expect(twitter.current.redditDone).toBe(true);
});

test('rejected worthy tweet still publishes normally without major announcement treatment', async () => {
  const current = item('2234567892');
  const twitter = new FakeTwitter(current);
  const publisher = new FakePublisher();
  const reviews = new FakeReviews(review(current.tweet.id, 'reject'));
  const bridge = new TwitterRedditBridge(twitter, await state(), reviews, publisher, () => 200);

  await bridge.deliverPending();
  expect(await bridge.syncReviews()).toEqual({ inspected: 1, completed: 1, failed: 0 });
  expect(await bridge.deliverPending()).toEqual({ inspected: 0, completed: 0, failed: 0 });
  expect(publisher.primaryMajor).toEqual([false]);
  expect(publisher.legacyMajor).toEqual([false]);
  expect(twitter.current.redditDone).toBe(true);
});
