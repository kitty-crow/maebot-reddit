import { afterEach, describe, expect, test } from 'bun:test';
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
  at: 100,
  author: { name: 'Nya', handle: 'NyaOnEarth', avatar: null },
  photos: [],
  videos: [],
  quote: null,
  poll: null,
});

const item = (id: string, worthy: boolean | null = null): TwitterItem => ({
  tweet: tweet(id),
  worthy,
  telegramDone: true,
  telegramMessageId: 'tg',
  discordDone: true,
  discordMessageId: 'dc',
  redditDone: false,
  redditDeliveryId: null,
  reviewKey: worthy === true ? `twitter:nyaonearth:${id}` : null,
  dailyDraft: null,
  dailyMedia: null,
});

class FakeTwitter implements TwitterApi {
  public relayCalls = 0;

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
    this.relayCalls += 1;
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
  public calls = 0;
  public fail = false;

  public constructor(public value: CanonicalDailyReview | null) {}

  public async twitter(): Promise<CanonicalDailyReview | null> {
    this.calls += 1;
    if (this.fail) throw new Error('review API temporarily unavailable');
    return this.value;
  }

  public async weekly(): Promise<readonly CanonicalWeeklyReview[]> {
    return [];
  }
}

class FakePublisher implements TwitterRedditPublisher {
  public primaryCalls = 0;
  public legacyCalls = 0;
  public primaryPinCalls = 0;
  public legacyPinCalls = 0;
  public legacyFailures = 0;
  public legacyPinFailures = 0;

  public async publishPrimary(): Promise<RedditPrimaryPost> {
    this.primaryCalls += 1;
    return { postId: 'primary-post' };
  }

  public async publishLegacy(): Promise<RedditLegacyPost> {
    this.legacyCalls += 1;
    if (this.legacyFailures > 0) {
      this.legacyFailures -= 1;
      throw new Error('synthetic legacy failure');
    }
    return { postId: 'legacy-post', mode: 'crosspost' };
  }

  public async pin(target: 'primary' | 'legacy'): Promise<void> {
    if (target === 'primary') {
      this.primaryPinCalls += 1;
      return;
    }
    this.legacyPinCalls += 1;
    if (this.legacyPinFailures > 0) {
      this.legacyPinFailures -= 1;
      throw new Error('synthetic legacy pin failure');
    }
  }
}

const state = async (): Promise<RedditStateStore> => {
  const root = await mkdtemp(join(tmpdir(), 'mae-reddit-twitter-bridge-'));
  roots.push(root);
  return new RedditStateStore(join(root, 'reddit.pb'));
};

const complete = async (store: RedditStateStore, value: TwitterItem): Promise<void> => {
  await store.ensureTwitter(value.tweet.id, value.tweet.url, value.tweet.at, 101, value.tweet.author.handle, value.worthy);
  await store.markTwitterDelivery(value.tweet.id, 'primary', 'primary-post', 'primary', 102);
  await store.markTwitterDelivery(value.tweet.id, 'legacy', 'legacy-post', 'crosspost', 103);
  await store.syncTwitterCanonical(value.tweet.id, value.tweet.author.handle, value.worthy, value.reviewKey);
};

describe('Twitter to Reddit delivery', () => {
  test('resumes after a legacy delivery failure without reposting the primary submission', async () => {
    const store = await state();
    const twitter = new FakeTwitter(item('1234567890'));
    const reviews = new FakeReviews(null);
    const publisher = new FakePublisher();
    publisher.legacyFailures = 1;
    const bridge = new TwitterRedditBridge(twitter, store, reviews, publisher, () => 200);

    const first = await bridge.deliverPending();
    expect(first.failed).toBe(1);
    expect(publisher.primaryCalls).toBe(1);
    expect(publisher.legacyCalls).toBe(1);
    expect((await store.twitter('1234567890'))?.primary.state).toBe('applied');
    expect((await store.twitter('1234567890'))?.legacy.state).toBe('failed');

    const second = await bridge.deliverPending();
    expect(second.failed).toBe(0);
    expect(publisher.primaryCalls).toBe(1);
    expect(publisher.legacyCalls).toBe(2);
    expect(twitter.relayCalls).toBe(1);
    expect((await store.twitter('1234567890'))?.acknowledged).toBe(true);
  });

  test('recovers the local acknowledgement flag when Twitter already accepted the receipt', async () => {
    const store = await state();
    const current = item('1234567891');
    await complete(store, current);
    const twitter = new FakeTwitter({ ...current, redditDone: true, redditDeliveryId: 'reddit:primary-post:legacy-post' });
    const publisher = new FakePublisher();
    const bridge = new TwitterRedditBridge(twitter, store, new FakeReviews(null), publisher, () => 200);

    await bridge.deliverPending();
    expect((await store.twitter('1234567891'))?.acknowledged).toBe(true);
    expect(publisher.primaryCalls).toBe(0);
    expect(publisher.legacyCalls).toBe(0);
    expect(twitter.relayCalls).toBe(0);
  });
});

describe('canonical Daily Task review pinning', () => {
  test('persists approval and retries only the missing subreddit pin', async () => {
    const store = await state();
    const current = item('1234567892', true);
    await complete(store, current);
    const twitter = new FakeTwitter({ ...current, redditDone: true });
    const reviews = new FakeReviews({
      key: 'twitter:nyaonearth:1234567892',
      account: 'NyaOnEarth',
      tweetId: '1234567892',
      decision: { choice: 'approve', at: 300 },
      applied: true,
    });
    const publisher = new FakePublisher();
    publisher.legacyPinFailures = 1;
    const bridge = new TwitterRedditBridge(twitter, store, reviews, publisher, () => 200);

    const first = await bridge.syncReviews();
    expect(first.failed).toBe(1);
    expect((await store.twitter('1234567892'))?.reviewDecision).toBe('approve');
    expect((await store.twitter('1234567892'))?.primaryPinApplied).toBe(true);
    expect((await store.twitter('1234567892'))?.legacyPinApplied).toBe(false);

    reviews.fail = true;
    const second = await bridge.syncReviews();
    expect(second.failed).toBe(0);
    expect(publisher.primaryPinCalls).toBe(1);
    expect(publisher.legacyPinCalls).toBe(2);
    expect(reviews.calls).toBe(1);
    expect((await store.twitter('1234567892'))?.legacyPinApplied).toBe(true);
  });

  test('rejection leaves both normal Reddit posts in place and never pins them', async () => {
    const store = await state();
    const current = item('1234567893', true);
    await complete(store, current);
    const reviews = new FakeReviews({
      key: 'twitter:nyaonearth:1234567893',
      account: 'NyaOnEarth',
      tweetId: '1234567893',
      decision: { choice: 'reject', at: 301 },
      applied: false,
    });
    const publisher = new FakePublisher();
    const bridge = new TwitterRedditBridge(new FakeTwitter(current), store, reviews, publisher, () => 200);

    const result = await bridge.syncReviews();
    expect(result.completed).toBe(1);
    expect(publisher.primaryPinCalls).toBe(0);
    expect(publisher.legacyPinCalls).toBe(0);
    const saved = await store.twitter('1234567893');
    expect(saved?.reviewDecision).toBe('reject');
    expect(saved?.primary.postId).toBe('primary-post');
    expect(saved?.legacy.postId).toBe('legacy-post');
  });

  test('non-worthy tweets become review-complete without querying Telegram forever', async () => {
    const store = await state();
    const current = item('1234567894', null);
    await complete(store, current);
    const twitter = new FakeTwitter({ ...current, worthy: false, redditDone: true });
    const reviews = new FakeReviews(null);
    const bridge = new TwitterRedditBridge(twitter, store, reviews, new FakePublisher(), () => 200);

    await bridge.syncReviews();
    expect(reviews.calls).toBe(0);
    expect((await store.twitter('1234567894'))?.worthy).toBe(false);
    expect(await store.twitterReviewCandidates()).toEqual([]);
  });
});
