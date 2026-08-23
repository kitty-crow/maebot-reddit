import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WEEKLY_HIGHLIGHT_LABEL,
  WEEKLY_HIGHLIGHT_REMOVE_AFTER,
  WEEKLY_SUMMARY_FLAIR,
  weeklyHighlightExpiresAt,
} from '../src/daily/redditPolicy.ts';
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

test('weekly Reddit policy uses the minor flair and Announcement highlight for this week', () => {
  expect(WEEKLY_SUMMARY_FLAIR).toBe('Minor Announcement :lisa:');
  expect(WEEKLY_HIGHLIGHT_LABEL).toBe('Announcement');
  expect(WEEKLY_HIGHLIGHT_REMOVE_AFTER).toBe('this-week');
  expect(weeklyHighlightExpiresAt('2026-08-23')).toBe(Date.parse('2026-08-30T00:00:00Z') / 1_000);
});

test('approved weekly summary is posted and highlighted once on primary and legacy Reddit targets', async () => {
  const state = await store();
  let primary = 0;
  let legacy = 0;
  const highlights: string[] = [];
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
    highlight: async (target, postId) => { highlights.push(`${target}:${postId}`); },
    unhighlight: async () => undefined,
  };
  const relay = new WeeklyRedditRelay(reviews([weekly]), state, publisher, false, () => 120);

  expect(await relay.sync()).toEqual({ inspected: 1, completed: 1, failed: 0 });
  expect(primary).toBe(1);
  expect(legacy).toBe(1);
  expect(highlights).toEqual(['primary:primary1', 'legacy:legacy1']);

  expect(await relay.sync()).toEqual({ inspected: 0, completed: 0, failed: 0 });
  expect(primary).toBe(1);
  expect(legacy).toBe(1);
  expect(highlights).toHaveLength(2);
});

test('legacy failure retries only the missing side without duplicating primary post or highlight', async () => {
  const state = await store();
  let primary = 0;
  let legacy = 0;
  let primaryHighlight = 0;
  let legacyHighlight = 0;
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
    highlight: async target => {
      if (target === 'primary') primaryHighlight += 1;
      else legacyHighlight += 1;
    },
    unhighlight: async () => undefined,
  };
  const relay = new WeeklyRedditRelay(reviews([weekly]), state, publisher, false, () => 130);

  expect(await relay.sync()).toEqual({ inspected: 1, completed: 0, failed: 1 });
  expect(primary).toBe(1);
  expect(legacy).toBe(1);
  expect(primaryHighlight).toBe(1);
  expect(legacyHighlight).toBe(0);

  expect(await relay.sync()).toEqual({ inspected: 1, completed: 1, failed: 0 });
  expect(primary).toBe(1);
  expect(legacy).toBe(2);
  expect(primaryHighlight).toBe(1);
  expect(legacyHighlight).toBe(1);

  expect(await relay.sync()).toEqual({ inspected: 0, completed: 0, failed: 0 });
});

test('single-subreddit mode publishes and highlights exactly one weekly Reddit post', async () => {
  const state = await store();
  let primary = 0;
  let legacy = 0;
  let highlights = 0;
  const publisher: WeeklyRedditPublisher = {
    publishPrimary: async () => {
      primary += 1;
      return { postId: 'single1' };
    },
    publishLegacy: async () => {
      legacy += 1;
      return { postId: 'never', mode: 'crosspost' };
    },
    highlight: async () => { highlights += 1; },
    unhighlight: async () => undefined,
  };
  const relay = new WeeklyRedditRelay(reviews([weekly]), state, publisher, true, () => 140);

  expect(await relay.sync()).toEqual({ inspected: 1, completed: 1, failed: 0 });
  expect(await relay.sync()).toEqual({ inspected: 0, completed: 0, failed: 0 });
  expect(primary).toBe(1);
  expect(legacy).toBe(0);
  expect(highlights).toBe(1);
});

test('weekly highlights are removed once when the week ends without deleting the Reddit posts', async () => {
  const state = await store();
  let now = weeklyHighlightExpiresAt(weekly.weekStart) - 1;
  const highlighted: string[] = [];
  const unhighlighted: string[] = [];
  const publisher: WeeklyRedditPublisher = {
    publishPrimary: async () => ({ postId: 'primary-expiry' }),
    publishLegacy: async () => ({ postId: 'legacy-expiry', mode: 'crosspost' }),
    highlight: async (target, postId) => { highlighted.push(`${target}:${postId}`); },
    unhighlight: async (target, postId) => { unhighlighted.push(`${target}:${postId}`); },
  };
  const relay = new WeeklyRedditRelay(reviews([weekly]), state, publisher, false, () => now);

  expect(await relay.sync()).toEqual({ inspected: 1, completed: 1, failed: 0 });
  expect(highlighted).toEqual(['primary:primary-expiry', 'legacy:legacy-expiry']);
  expect(unhighlighted).toEqual([]);

  now = weeklyHighlightExpiresAt(weekly.weekStart);
  expect(await relay.sync()).toEqual({ inspected: 0, completed: 0, failed: 0 });
  expect(unhighlighted).toEqual(['primary:primary-expiry', 'legacy:legacy-expiry']);

  expect(await relay.sync()).toEqual({ inspected: 0, completed: 0, failed: 0 });
  expect(unhighlighted).toHaveLength(2);
});
