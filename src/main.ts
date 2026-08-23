import 'dotenv/config';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { TwitterClient } from '../vendor/maebot-twitter/src/index.ts';
import { LiveWeeklyRedditPublisher, WeeklyRedditRelay } from './daily/weekly.ts';
import {
  dailyReviewApiConfig,
  internalApiConfig,
  redditConfig,
  redditModerationConfig,
  twitterApiConfig,
} from './env.ts';
import { RedditInternalHttpServer } from './http/server.ts';
import { BidirectionalPostMirror } from './mirror/service.ts';
import { PostMirrorStore } from './mirror/store.ts';
import { RedditModerationRuntime } from './mod/runtime.ts';
import { ModerationReviewStore } from './mod/review.ts';
import { QuestionEventStore } from './questions/events.ts';
import { ReputationStore } from './reputation/store.ts';
import { RedditReadClient } from './reddit/client.ts';
import { safeError } from './reddit/error.ts';
import { RedditMutationClient } from './reddit/mutate.ts';
import { DailyReviewClient } from './review/client.ts';
import { RedditStateStore } from './store/state.ts';
import { TwitterRedditBridge } from './twitter/bridge.ts';
import { LiveTwitterRedditPublisher } from './twitter/publisher.ts';

const redditCfg = redditConfig();
const moderationCfg = redditModerationConfig();
const twitterCfg = twitterApiConfig();
const reviewCfg = dailyReviewApiConfig();
const internalCfg = internalApiConfig();
const singleTarget = redditCfg.primarySubreddit.toLowerCase() === redditCfg.sourceSubreddit.toLowerCase();
const twitter = new TwitterClient(twitterCfg);
const state = new RedditStateStore(redditCfg.stateFile);
const reviews = new DailyReviewClient(reviewCfg);
const publisher = new LiveTwitterRedditPublisher(redditCfg);
const bridge = new TwitterRedditBridge(twitter, state, reviews, publisher, undefined, singleTarget);
const weekly = new WeeklyRedditRelay(
  reviews,
  state,
  new LiveWeeklyRedditPublisher(redditCfg),
  singleTarget,
);
const postMirror = singleTarget
  ? null
  : new BidirectionalPostMirror(
      new RedditReadClient(redditCfg.auth),
      new RedditMutationClient(redditCfg.auth),
      new PostMirrorStore(resolve(process.cwd(), process.env['REDDIT_MIRROR_STATE_FILE']?.trim() || 'data/postMirror.pb')),
      redditCfg.primarySubreddit,
      redditCfg.sourceSubreddit,
    );
const moderation = moderationCfg === null
  ? null
  : new RedditModerationRuntime(
      redditCfg.sourceSubreddit,
      moderationCfg,
      new RedditReadClient(redditCfg.auth),
      new RedditMutationClient(redditCfg.auth),
      new ReputationStore(moderationCfg.stateFile),
    );

const pollMs = (() => {
  const raw = process.env['REDDIT_TWITTER_POLL_MS']?.trim() || '5000';
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1000) throw new Error('REDDIT_TWITTER_POLL_MS must be an integer of at least 1000');
  return value;
})();

const internal = internalCfg === null
  ? null
  : new RedditInternalHttpServer(internalCfg, new QuestionEventStore(), new ModerationReviewStore());
internal?.start();
if (internal !== null) console.log(`Reddit internal event API listening on ${internal.address()}.`);

let ticking = false;
const tick = async (): Promise<void> => {
  if (ticking) return;
  ticking = true;
  try {
    const delivery = await bridge.deliverPending();
    const mirror = postMirror === null ? null : await postMirror.tick();
    const review = await bridge.syncReviews();
    const weeklyResult = await weekly.sync();
    let moderationResult = null;
    if (moderation !== null) {
      try {
        moderationResult = await moderation.tick();
      } catch (error) {
        console.error(`[Reddit moderation] tick failed: ${safeError(error)}`);
      }
    }
    if (mirror !== null && (mirror.seeded || mirror.discovered > 0 || mirror.completed > 0 || mirror.failed > 0)) {
      console.log(`[Reddit post mirror] seeded=${mirror.seeded} discovered=${mirror.discovered} completed=${mirror.completed} failed=${mirror.failed}`);
    }
    if (delivery.inspected > 0 || delivery.completed > 0 || delivery.failed > 0) {
      console.log(`[Reddit Twitter bridge] delivery inspected=${delivery.inspected} completed=${delivery.completed} failed=${delivery.failed}`);
    }
    if (review.inspected > 0 || review.completed > 0 || review.failed > 0) {
      console.log(`[Reddit Twitter bridge] reviews inspected=${review.inspected} completed=${review.completed} failed=${review.failed}`);
    }
    if (weeklyResult.inspected > 0 || weeklyResult.completed > 0 || weeklyResult.failed > 0) {
      console.log(`[Reddit weekly Daily Task] inspected=${weeklyResult.inspected} completed=${weeklyResult.completed} failed=${weeklyResult.failed}`);
    }
    if (moderationResult !== null && (
      moderationResult.audited > 0
      || moderationResult.exempt > 0
      || moderationResult.scoreCredits > 0
      || moderationResult.effectsApplied > 0
      || moderationResult.failed > 0
    )) {
      console.log(
        `[Reddit moderation] discovered=${moderationResult.discovered} audited=${moderationResult.audited} exempt=${moderationResult.exempt} scoreCredits=${moderationResult.scoreCredits} effects=${moderationResult.effectsApplied} failed=${moderationResult.failed}`,
      );
    }
  } finally {
    ticking = false;
  }
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const startupSmoke = async (): Promise<void> => {
  const id = process.env['REDDIT_STARTUP_SMOKE_TWEET_ID']?.trim();
  if (id === undefined || id.length === 0) return;
  if (!/^\d{2,24}$/u.test(id)) throw new Error('REDDIT_STARTUP_SMOKE_TWEET_ID must be a Twitter status id');

  const marker = resolve(
    process.cwd(),
    process.env['REDDIT_STARTUP_SMOKE_MARKER']?.trim() || `data/reddit-twitter-smoke-${id}.done`,
  );
  if (await exists(marker)) {
    console.log(`[Reddit startup smoke] ${id} already completed; marker=${marker}`);
    return;
  }

  const response = await fetch(`${twitterCfg.base}/v1/smoke/${encodeURIComponent(id)}?force=1&target=reddit`, {
    method: 'POST',
    headers: { authorization: `Bearer ${twitterCfg.token}` },
  });
  if (!response.ok) throw new Error(`Twitter Reddit-only smoke queue failed with HTTP ${response.status}`);
  console.log(`[Reddit startup smoke] canonical Twitter item ${id} queued for Reddit only.`);

  await tick();
  const item = await twitter.item(id);
  if (item?.redditDone !== true) throw new Error(`Reddit startup smoke ${id} did not complete Reddit delivery`);
  await mkdir(dirname(marker), { recursive: true });
  await writeFile(marker, `${new Date().toISOString()} ${id}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`[Reddit startup smoke] ${id} delivered through the real Reddit pipeline; marker=${marker}`);
};

if (singleTarget) {
  console.log(`Mae Reddit single-subreddit mode starting for r/${redditCfg.primarySubreddit}.`);
  console.log('Cross-subreddit mirroring and migration are disabled until distinct source/primary subreddits are configured.');
} else {
  console.log(`Mae Reddit Twitter consumer, weekly Daily Task relay and bidirectional post mirror starting for r/${redditCfg.primarySubreddit} ⇄ r/${redditCfg.sourceSubreddit}.`);
}
if (moderation === null) {
  console.log('LLM comment/submission moderation is disabled by REDDIT_MODERATION_ENABLED.');
} else {
  console.log(`LLM comment/submission moderation and internal reputation are enabled for r/${redditCfg.sourceSubreddit}.`);
}

if (postMirror !== null) await postMirror.tick();
await startupSmoke();
await tick();
const timer = setInterval(() => {
  void tick().catch(error => console.error('[Reddit runtime] periodic tick failed:', error));
}, pollMs);

let stopping = false;
const stop = (): void => {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  internal?.stop();
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
