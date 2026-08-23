import 'dotenv/config';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { TwitterClient } from '../vendor/maebot-twitter/src/index.ts';
import { LiveWeeklyRedditPublisher, WeeklyRedditRelay } from './daily/weekly.ts';
import {
  dailyReviewApiConfig,
  internalApiConfig,
  modmailTerminalConfig,
  redditConfig,
  redditModerationConfig,
  twitterApiConfig,
} from './env.ts';
import { RedditInternalHttpServer } from './http/server.ts';
import { BidirectionalPostMirror } from './mirror/service.ts';
import { PostMirrorStore } from './mirror/store.ts';
import { PrivateModmailRuntime } from './mod/privateRuntime.ts';
import { ModerationReviewStore } from './mod/review.ts';
import { RedditModerationRuntime } from './mod/runtime.ts';
import { ModmailAuditStore } from './modmail/auditStore.ts';
import { ModmailReplyOutbox } from './modmail/outbox.ts';
import { ModmailRuntime } from './modmail/runtime.ts';
import { ModmailStore } from './modmail/store.ts';
import { ModmailTerminalServer } from './modmail/terminalServer.ts';
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
const terminalCfg = modmailTerminalConfig();
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
const moderationReviews = new ModerationReviewStore();
const modmailStore = new ModmailStore(resolve(process.cwd(), process.env['REDDIT_MODMAIL_STATE_FILE']?.trim() || 'data/modmail.pb'));
const modmailAudit = new ModmailAuditStore(resolve(process.cwd(), process.env['REDDIT_MODMAIL_AUDIT_FILE']?.trim() || 'data/modmailAudit.pb'));
const modmailOutbox = new ModmailReplyOutbox(resolve(process.cwd(), process.env['REDDIT_MODMAIL_OUTBOX_FILE']?.trim() || 'data/modmailReplies.pb'));
const terminal = terminalCfg === null ? null : new ModmailTerminalServer(terminalCfg, modmailStore, modmailOutbox);
const moderationReader = moderationCfg === null ? null : new RedditReadClient(redditCfg.auth);
const moderationWriter = moderationCfg === null ? null : new RedditMutationClient(redditCfg.auth);
const reputation = moderationCfg === null ? null : new ReputationStore(moderationCfg.stateFile);
const moderation = moderationCfg === null || moderationReader === null || moderationWriter === null || reputation === null
  ? null
  : new RedditModerationRuntime(
      redditCfg.sourceSubreddit,
      moderationCfg,
      moderationReader,
      moderationWriter,
      reputation,
      null,
      moderationReviews,
    );
const modmail = moderationCfg === null || moderationReader === null || moderationWriter === null || reputation === null
  ? null
  : new ModmailRuntime(
      redditCfg.sourceSubreddit,
      moderationCfg,
      moderationReader,
      moderationWriter,
      reputation,
      modmailStore,
      null,
      null,
      modmailOutbox,
    );
const privateModmail = moderationCfg === null || reputation === null
  ? null
  : new PrivateModmailRuntime(
      moderationCfg.ai,
      modmailStore,
      modmailAudit,
      reputation,
    );

const pollMs = (() => {
  const raw = process.env['REDDIT_TWITTER_POLL_MS']?.trim() || '5000';
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1000) throw new Error('REDDIT_TWITTER_POLL_MS must be an integer of at least 1000');
  return value;
})();

terminal?.start();
if (terminal !== null) console.log(`Focused Reddit modmail terminal listening on ${terminal.address()}; public base=${terminalCfg?.publicBase ?? 'unavailable'}.`);

const internal = internalCfg === null
  ? null
  : new RedditInternalHttpServer(internalCfg, new QuestionEventStore(), moderationReviews);
internal?.useModmail(modmailStore, modmailOutbox, terminal, reputation);
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
    let modmailResult = null;
    if (modmail !== null) {
      try {
        modmailResult = await modmail.tick();
      } catch (error) {
        console.error(`[Reddit modmail] tick failed: ${safeError(error)}`);
      }
    }
    let privateModmailResult = null;
    if (privateModmail !== null) {
      try {
        privateModmailResult = await privateModmail.tick();
      } catch (error) {
        console.error(`[Reddit private moderation] tick failed: ${safeError(error)}`);
      }
    }
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
    if (modmailResult !== null && (
      modmailResult.relayed > 0
      || modmailResult.repliesApplied > 0
      || modmailResult.failed > 0
    )) {
      console.log(
        `[Reddit modmail] relayed=${modmailResult.relayed} replies=${modmailResult.repliesApplied} failed=${modmailResult.failed}`,
      );
    }
    if (privateModmailResult !== null && (
      privateModmailResult.inspected > 0
      || privateModmailResult.audited > 0
      || privateModmailResult.apologies > 0
      || privateModmailResult.failed > 0
    )) {
      console.log(
        `[Reddit private moderation] inspected=${privateModmailResult.inspected} audited=${privateModmailResult.audited} apologies=${privateModmailResult.apologies} skipped=${privateModmailResult.skipped} failed=${privateModmailResult.failed}`,
      );
    }
    if (moderationResult !== null && (
      moderationResult.audited > 0
      || moderationResult.exempt > 0
      || moderationResult.scoreCredits > 0
      || moderationResult.voteReviews > 0
      || moderationResult.reviewActions > 0
      || moderationResult.flairRestored > 0
      || moderationResult.effectsApplied > 0
      || moderationResult.failed > 0
    )) {
      console.log(
        `[Reddit moderation] discovered=${moderationResult.discovered} audited=${moderationResult.audited} exempt=${moderationResult.exempt} scoreCredits=${moderationResult.scoreCredits} voteReviews=${moderationResult.voteReviews} reviewActions=${moderationResult.reviewActions} flairRestored=${moderationResult.flairRestored} effects=${moderationResult.effectsApplied} failed=${moderationResult.failed}`,
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
  console.log('LLM Reddit moderation and internal reputation are disabled by REDDIT_MODERATION_ENABLED.');
} else {
  console.log(`LLM post/comment/modmail moderation and internal reputation are enabled for r/${redditCfg.sourceSubreddit}.`);
}

if (privateModmail !== null) {
  const seeded = await privateModmail.bootstrap();
  console.log(`Private modmail moderation activation boundary established; existing relay events skipped=${seeded}.`);
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
  terminal?.stop();
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);