import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WeeklyRedditRelay,
  type WeeklyRedditPublisher,
} from '../src/daily/weekly.ts';
import type {
  CanonicalWeeklyReview,
  DailyReviewApi,
} from '../src/review/client.ts';
import { RedditStateStore } from '../src/store/state.ts';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const store = async (): Promise<RedditStateStore> => {
  const root = await mkdtemp(join(tmpdir(), 'mae-reddit-weekly-'));
  roots.push(root);
  return new RedditStateStore(join(root, 'reddit.pb'));
};

const weekly: CanonicalWeeklyReview = {
  key: 'weekly:2026-08-23',
  weekStart: '2026-08-23',
  markdown: 'Meowdy! Mae here with the Daily Tasks, Nya!\n\n🌱 **Today’s Tasks**\n- Keep up with the weekly priorities.',
  decision: { choice: 'approve', at: 110 },
  applied: true,
  media: { kind: 'image', mime: 'image/png', size: 123 },
};

const reviews = (items: readonly CanonicalWeeklyReview[]): DailyReviewApi => ({
  twitter: async () => null,
  weekly: async () => items,
});

test('approved weekly summary is posted once to primary and legacy Reddit targets', async () => {
  const state = await store();
  let primary = 0;
  let legacy = 0;
  const publisher: WeeklyRedditPublisher = {
    publishPrimary: async review => {
      primary += 1;
      expect(review).toEqual(weekly);
      return { postId: 'primary1' };
    },
    publishLegacy: async (review, primaryPostId) => {
      legacy += 1;
      expect(review.key).toBe(weekly.key);
      expect(primaryPostId).toBe('primary1');
      return { postId: 'legacy1', mode: 'crosspost' };
    },
  };
  const relay = new WeeklyRedditRelay(reviews([weekly]), state, publisher, false, () => 120);

  expect(await relay.sync()).toEqual({ inspected: 1, completed: 1, failed: 0 });
  expect(primary).toBe(1);
  expect(legacy).toBe(1);

  expect(await relay.sync()).toEqual({ inspected: 0, completed: 0, failed: 0 });
  expect(primary).toBe(1);
  expect(legacy).toBe(1);
});

test('legacy failure retries only the missing side without duplicating the primary weekly post', async () => {
  const state = await store();
  let primary = 0;
  let legacy = 0;
  const publisher: WeeklyRedditPublisher = {
    publishPrimary: async () => {
      primary += 1;
      return { postId: 'primary2' };
    },
    publishLegacy: async () => {
      legacy += 1;
      if (legacy === 1) throw new Error('temporary crosspost failure');
      return { postId: 'legacy2', mode: 'fallback' };
    },
  };
  const relay = new WeeklyRedditRelay(reviews([weekly]), state, publisher, false, () => 130);

  expect(await relay.sync()).toEqual({ inspected: 1, completed: 0, failed: 1 });
  expect(primary).toBe(1);
  expect(legacy).toBe(1);

  expect(await relay.sync()).toEqual({ inspected: 1, completed: 1, failed: 0 });
  expect(primary).toBe(1);
  expect(legacy).toBe(2);

  expect(await relay.sync()).toEqual({ inspected: 0, completed: 0, failed: 0 });
});

test('single-subreddit mode publishes exactly one weekly Reddit post', async () => {
  const state = await store();
  let primary = 0;
  let legacy = 0;
  const publisher: WeeklyRedditPublisher = {
    publishPrimary: async () => {
      primary += 1;
      return { postId: 'single1' };
    },
    publishLegacy: async () => {
      legacy += 1;
      return { postId: 'never', mode: 'crosspost' };
    },
  };
  const relay = new WeeklyRedditRelay(reviews([weekly]), state, publisher, true, () => 140);

  expect(await relay.sync()).toEqual({ inspected: 1, completed: 1, failed: 0 });
  expect(await relay.sync()).toEqual({ inspected: 0, completed: 0, failed: 0 });
  expect(primary).toBe(1);
  expect(legacy).toBe(0);
});
