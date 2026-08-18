import 'dotenv/config';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { TwitterClient } from '../vendor/maebot-twitter/src/index.ts';
import {
  dailyReviewApiConfig,
  internalApiConfig,
  redditConfig,
  twitterApiConfig,
} from './env.ts';
import { RedditInternalHttpServer } from './http/server.ts';
import { BidirectionalPostMirror } from './mirror/service.ts';
import { PostMirrorStore } from './mirror/store.ts';
import { ModerationReviewStore } from './mod/review.ts';
import { QuestionEventStore } from './questions/events.ts';
import { RedditReadClient } from './reddit/client.ts';
import { RedditMutationClient } from './reddit/mutate.ts';
import { DailyReviewClient } from './review/client.ts';
import { RedditStateStore } from './store/state.ts';
import { TwitterRedditBridge } from './twitter/bridge.ts';
import { LiveTwitterRedditPublisher } from './twitter/publisher.ts';

const redditCfg = redditConfig();
const twitterCfg = twitterApiConfig();
const reviewCfg = dailyReviewApiConfig();
const internalCfg = internalApiConfig();
const twitter = new TwitterClient(twitterCfg);
const state = new RedditStateStore(redditCfg.stateFile);
const reviews = new DailyReviewClient(reviewCfg);
const publisher = new LiveTwitterRedditPublisher(redditCfg);
const bridge = new TwitterRedditBridge(twitter, state, reviews, publisher);
const postMirror = new BidirectionalPostMirror(
  new RedditReadClient(redditCfg.auth),
  new RedditMutationClient(redditCfg.auth),
  new PostMirrorStore(resolve(process.cwd(), process.env['REDDIT_MIRROR_STATE_FILE']?.trim() || 'data/postMirror.pb')),
  redditCfg.primarySubreddit,
  redditCfg.sourceSubreddit,
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
    const mirror = await postMirror.tick();
    const delivery = await bridge.deliverPending();
    const review = await bridge.syncReviews();
    if (mirror.seeded || mirror.discovered > 0 || mirror.completed > 0 || mirror.failed > 0) {
      console.log(`[Reddit post mirror] seeded=${mirror.seeded} discovered=${mirror.discovered} completed=${mirror.completed} failed=${mirror.failed}`);
    }
    if (delivery.inspected > 0 || delivery.completed > 0 || delivery.failed > 0) {
      console.log(`[Reddit Twitter bridge] delivery inspected=${delivery.inspected} completed=${delivery.completed} failed=${delivery.failed}`);
    }
    if (review.inspected > 0 || review.completed > 0 || review.failed > 0) {
      console.log(`[Reddit Twitter bridge] reviews inspected=${review.inspected} completed=${review.completed} failed=${review.failed}`);
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
  if (item?.redditDone !== true) throw new Error(`Reddit startup smoke ${id} did not complete both subreddit deliveries`);
  await mkdir(dirname(marker), { recursive: true });
  await writeFile(marker, `${new Date().toISOString()} ${id}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`[Reddit startup smoke] ${id} delivered through the real Reddit fanout pipeline; marker=${marker}`);
};

console.log(`Mae Reddit Twitter consumer and bidirectional post mirror starting for r/${redditCfg.primarySubreddit} ⇄ r/${redditCfg.sourceSubreddit}.`);
console.log('Legacy comment/submission moderation ingestion is intentionally offline during this cutover window.');

// Establish both subreddit baselines before the controlled startup smoke. This
// avoids historical backfill; only posts appearing after cutover are mirrored.
await postMirror.tick();
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
