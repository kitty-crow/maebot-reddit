import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DailyMedia, Tweet, TwitterApi, TwitterItem, TwitterPlatform } from '../vendor/maebot-twitter/src/index.ts';
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
  public async worthyWithoutReview(): Promise<readonly TwitterItem[]> { return []; }
  public async markRelay(platform: TwitterPlatform, id: string, messageId: string): Promise<void> {
    if (platform !== 'reddit' || id !== this.current.tweet.id) throw new Error('unexpected relay');
    this.relayCalls += 1;
    this.current = { ...this.current, redditDone: true, redditDeliveryId: messageId };
  }
  public async prepareDaily(): Promise<string> { throw new Error('not used'); }
  public async cacheDailyMedia(_id: string, _media: DailyMedia): Promise<void> { throw new Error('not used'); }
  public async attachReview(): Promise<void> { throw new Error('not used'); }
}

class FakeReviews implements DailyReviewApi {
  public constructor(public value: CanonicalDailyReview | null) {}
  public async twitter(): Promise<CanonicalDailyReview | null> { return this.value; }
  public async weekly(): Promise<readonly CanonicalWeeklyReview[]> { return []; }
}

class FakePublisher implements TwitterRedditPublisher {
  public primaryCalls = 0;
  public legacyCalls = 0;
  public primaryPinCalls = 0;
  public legacyPinCalls = 0;
  public async publishPrimary(): Promise<RedditPrimaryPost> {
    this.primaryCalls += 1;
    return { postId: 'catgirlcoin-post' };
  }
  public async publishLegacy(): Promise<RedditLegacyPost> {
    this.legacyCalls += 1;
    return { postId: 'must-not-exist', mode: 'crosspost' };
  }
  public async pin(target: 'primary' | 'legacy'): Promise<void> {
    if (target === 'primary') this.primaryPinCalls += 1;
    else this.legacyPinCalls += 1;
  }
}

const state = async (): Promise<RedditStateStore> => {
  const root = await mkdtemp(join(tmpdir(), 'mae-reddit-single-target-'));
  roots.push(root);
  return new RedditStateStore(join(root, 'reddit.pb'));
};

describe('single-subreddit Twitter delivery', () => {
  test('publishes once and completes both durable delivery legs with the same post id', async () => {
    const store = await state();
    const twitter = new FakeTwitter(item('2089317450781442556'));
    const publisher = new FakePublisher();
    const bridge = new TwitterRedditBridge(twitter, store, new FakeReviews(null), publisher, () => 200, true);

    const result = await bridge.deliverPending();
    expect(result).toEqual({ inspected: 1, completed: 1, failed: 0 });
    expect(publisher.primaryCalls).toBe(1);
    expect(publisher.legacyCalls).toBe(0);
    expect(twitter.relayCalls).toBe(1);

    const saved = await store.twitter('2089317450781442556');
    expect(saved?.primary.postId).toBe('catgirlcoin-post');
    expect(saved?.legacy.postId).toBe('catgirlcoin-post');
    expect(saved?.primary.mode).toBe('primary');
    expect(saved?.legacy.mode).toBe('primary');
    expect(saved?.acknowledged).toBe(true);
  });

  test('approved Daily Task pins the single Reddit post exactly once', async () => {
    const store = await state();
    const current = item('2089317450781442557', true);
    const twitter = new FakeTwitter(current);
    const publisher = new FakePublisher();
    const bridge = new TwitterRedditBridge(
      twitter,
      store,
      new FakeReviews({
        key: 'twitter:nyaonearth:2089317450781442557',
        account: 'NyaOnEarth',
        tweetId: '2089317450781442557',
        decision: { choice: 'approve', at: 300 },
        applied: true,
      }),
      publisher,
      () => 200,
      true,
    );

    await bridge.deliverPending();
    const result = await bridge.syncReviews();
    expect(result.failed).toBe(0);
    expect(publisher.primaryPinCalls).toBe(1);
    expect(publisher.legacyPinCalls).toBe(0);
    const saved = await store.twitter('2089317450781442557');
    expect(saved?.primaryPinApplied).toBe(true);
    expect(saved?.legacyPinApplied).toBe(true);
  });
});
