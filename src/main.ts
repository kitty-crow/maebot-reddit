import 'dotenv/config';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { TwitterClient } from '../vendor/maebot-twitter/src/index.ts';
import { LiveWeeklyRedditPublisher, WeeklyRedditRelay } from './daily/weekly.ts';
import { RedditDmRuntime } from './dm/runtime.ts';
import { DmStore } from './dm/store.ts';
import {
  dailyReviewApiConfig,
  internalApiConfig,
  redditConfig,
  redditDmConfig,
  redditModerationConfig,
  twitterApiConfig,
} from './env.ts';
import { RedditInternalHttpServer } from './http/server.ts';
import { BidirectionalPostMirror } from './mirror/service.ts';
import { PostMirrorStore } from './mirror/store.ts';
import { PrivateModmailRuntime } from './mod/privateRuntime.ts';
import { ModerationPrivileges, type ModerationPrivilegeSource } from './mod/privileges.ts';
import { ModerationReviewStore } from './mod/review.ts';
import { RedditModerationRuntime } from './mod/runtime.ts';
import { ModmailAuditStore } from './modmail/auditStore.ts';
import { ModmailMediaService } from './modmail/media/service.ts';
import { ModmailMediaStore } from './modmail/media/store.ts';
import { ModmailReplyOutbox } from './modmail/outbox.ts';
import { ModmailRuntime } from './modmail/runtime.ts';
import { ModmailStore } from './modmail/store.ts';
import { QuestionEventStore } from './questions/events.ts';
import { CommunityProjectionRuntime } from './reputation/communityProjectionRuntime.ts';
import { CommunityProjectionStore } from './reputation/communityProjectionStore.ts';
import { ReputationPostMirrorGate } from './reputation/mirrorGate.ts';
import { ReputationStore } from './reputation/store.ts';
import { RedditReadClient } from './reddit/client.ts';
import { safeError } from './reddit/error.ts';
import { RedditMediaClient } from './reddit/media.ts';
import { RedditMutationClient } from './reddit/mutate.ts';
import { DailyReviewClient } from './review/client.ts';
import { RedditStateStore } from './store/state.ts';
import { TwitterRedditBridge } from './twitter/bridge.ts';
import { LiveTwitterRedditPublisher } from './twitter/publisher.ts';

const canonicalSourceSubreddit = 'catgirlcoin';
const canonicalTargetSubreddit = 'nyaonearth';

const redditCfg = redditConfig();
const moderationCfg = redditModerationConfig();
const dmCfg = redditDmConfig();
const twitterCfg = twitterApiConfig();
const reviewCfg = dailyReviewApiConfig();
const internalCfg = internalApiConfig();
if (dmCfg !== null && moderationCfg === null) {
  throw new Error('REDDIT_DM_ENABLED requires REDDIT_MODERATION_ENABLED so private moderation stays canonical');
}

const sourceKey = redditCfg.sourceSubreddit.toLowerCase();
const primaryKey = redditCfg.primarySubreddit.toLowerCase();
const singleTarget = primaryKey === sourceKey;
if (moderationCfg !== null && sourceKey !== canonicalSourceSubreddit) {
  throw new Error('Canonical Reddit moderation requires REDDIT_SOURCE_SUBREDDIT=catgirlcoin');
}
if (
  moderationCfg !== null
  && primaryKey !== canonicalSourceSubreddit
  && primaryKey !== canonicalTargetSubreddit
) {
  throw new Error(
    'REDDIT_PRIMARY_SUBREDDIT must be catgirlcoin before community bootstrap or nyaonearth after cutover',
  );
}

// Moderation/Modmail activation is deliberately independent of publishing and
// post-mirror routing. This lets Mae protect NyaOnEarth first while the existing
// CatgirlCoin/CatgirlCoin publishing configuration stays untouched until the
// community bootstrap has completed.
const moderationCommunities = moderationCfg === null
  ? singleTarget
    ? [redditCfg.sourceSubreddit]
    : [redditCfg.sourceSubreddit, redditCfg.primarySubreddit]
  : [canonicalSourceSubreddit, canonicalTargetSubreddit];

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
const moderationReviews = new ModerationReviewStore();
const modmailStore = new ModmailStore(resolve(process.cwd(), process.env['REDDIT_MODMAIL_STATE_FILE']?.trim() || 'data/modmail.pb'));
const modmailAudit = new ModmailAuditStore(resolve(process.cwd(), process.env['REDDIT_MODMAIL_AUDIT_FILE']?.trim() || 'data/modmailAudit.pb'));
const modmailOutbox = new ModmailReplyOutbox(resolve(process.cwd(), process.env['REDDIT_MODMAIL_OUTBOX_FILE']?.trim() || 'data/modmailReplies.pb'));
const modmailMediaStore = new ModmailMediaStore(resolve(process.cwd(), process.env['REDDIT_MODMAIL_MEDIA_FILE']?.trim() || 'data/modmailMedia.pb'));
const modmailMedia = new ModmailMediaService(modmailStore, new RedditMediaClient(redditCfg.auth), modmailMediaStore);
const moderationReader = moderationCfg === null ? null : new RedditReadClient(redditCfg.auth);
const moderationWriter = moderationCfg === null ? null : new RedditMutationClient(redditCfg.auth);
const modmailReader = moderationReader ?? new RedditReadClient(redditCfg.auth);
const modmailWriter = moderationWriter ?? new RedditMutationClient(redditCfg.auth);
const reputation = moderationCfg === null ? null : new ReputationStore(moderationCfg.stateFile);
const postMirrorStore = singleTarget
  ? null
  : new PostMirrorStore(resolve(process.cwd(), process.env['REDDIT_MIRROR_STATE_FILE']?.trim() || 'data/postMirror.pb'));
const postMirror = postMirrorStore === null
  ? null
  : new BidirectionalPostMirror(
      new RedditReadClient(redditCfg.auth),
      new RedditMutationClient(redditCfg.auth),
      postMirrorStore,
      redditCfg.primarySubreddit,
      redditCfg.sourceSubreddit,
      reputation === null ? null : new ReputationPostMirrorGate(reputation),
    );
const communityProjectionStore = moderationCfg === null
  ? null
  : new CommunityProjectionStore(resolve(
      process.cwd(),
      process.env['REDDIT_COMMUNITY_PROJECTION_STATE_FILE']?.trim() || 'data/communityProjection.pb',
    ));

const privilegeCache = new Map<string, ModerationPrivileges>();
const privilegeFor = (subreddit: string): ModerationPrivileges | null => {
  if (moderationReader === null) return null;
  const key = subreddit.trim().toLowerCase();
  const existing = privilegeCache.get(key);
  if (existing !== undefined) return existing;
  const created = new ModerationPrivileges(subreddit, moderationReader);
  privilegeCache.set(key, created);
  return created;
};
const moderationPrivileges: ModerationPrivilegeSource | null = moderationReader === null
  ? null
  : {
      exemption: async author => {
        for (const subreddit of moderationCommunities) {
          const privileges = privilegeFor(subreddit);
          if (privileges === null) continue;
          const exemption = await privileges.exemption(author);
          if (exemption !== null) return exemption;
        }
        return null;
      },
    };

const moderation = moderationCfg === null
  || moderationReader === null
  || moderationWriter === null
  || reputation === null
  ? null
  : new RedditModerationRuntime(
      moderationCommunities,
      moderationCfg,
      moderationReader,
      moderationWriter,
      reputation,
      null,
      moderationReviews,
      null,
    );
const communityProjection = moderationCfg === null
  || moderationReader === null
  || moderationWriter === null
  || reputation === null
  || communityProjectionStore === null
  ? null
  : new CommunityProjectionRuntime(
      canonicalSourceSubreddit,
      canonicalTargetSubreddit,
      resolve(process.cwd(), process.env['REDDIT_FLAIR_CATALOGUE_FILE']?.trim() || 'data/flairs.json'),
      moderationCfg.flairReconcileMs,
      moderationReader,
      moderationWriter,
      reputation,
      communityProjectionStore,
    );
const modmail = new ModmailRuntime(
  moderationCommunities,
  modmailReader,
  modmailWriter,
  modmailStore,
  modmailOutbox,
);
const privateModmail = moderationCfg === null || reputation === null
  ? null
  : new PrivateModmailRuntime(
      moderationCfg.ai,
      modmailStore,
      modmailAudit,
      reputation,
      null,
      null,
      moderationPrivileges,
    );
const directMessages = dmCfg === null
  || moderationCfg === null
  || moderationReader === null
  || moderationWriter === null
  || reputation === null
  ? null
  : new RedditDmRuntime(
      redditCfg.sourceSubreddit,
      redditCfg.auth.username,
      moderationCfg.ai,
      dmCfg.replyAi,
      dmCfg.persona,
      moderationReader,
      moderationWriter,
      new DmStore(dmCfg.stateFile),
      reputation,
      moderationPrivileges,
    );

const intervalMs = (name: string, fallback: number, minimum: number): number => {
  const raw = process.env[name]?.trim();
  const value = raw === undefined || raw.length === 0 ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer of at least ${minimum}`);
  }
  return value;
};

const pollMs = intervalMs('REDDIT_TWITTER_POLL_MS', 5_000, 1_000);
const modmailPollMs = intervalMs('REDDIT_MODMAIL_POLL_MS', 15_000, 5_000);
const moderationPollMs = intervalMs('REDDIT_MODERATION_POLL_MS', 10_000, 5_000);
const dmPollMs = intervalMs('REDDIT_DM_POLL_MS', 15_000, 5_000);
const mirrorPollMs = intervalMs('REDDIT_MIRROR_POLL_MS', 10_000, 5_000);

const internal = internalCfg === null
  ? null
  : new RedditInternalHttpServer(internalCfg, new QuestionEventStore(), moderationReviews);
internal?.useModmail(modmailStore, modmailOutbox, modmailMedia, reputation, modmailWriter);
internal?.start();
if (internal !== null) console.log(`Reddit internal event API listening on ${internal.address()}.`);

let ticking = false;
let nextModmailAt = 0;
let nextModerationAt = 0;
let nextDmAt = 0;
let nextMirrorAt = 0;
const tick = async (): Promise<void> => {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    const delivery = await bridge.deliverPending();
    const review = await bridge.syncReviews();
    const weeklyResult = await weekly.sync();
    let modmailResult = null;
    if (now >= nextModmailAt) {
      nextModmailAt = now + modmailPollMs;
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
    let dmResult = null;
    if (directMessages !== null && dmCfg !== null && now >= nextDmAt) {
      nextDmAt = now + dmPollMs;
      try {
        dmResult = await directMessages.tick(dmCfg.batchSize);
      } catch (error) {
        console.error(`[Reddit DM] tick failed: ${safeError(error)}`);
      }
    }
    let moderationResult = null;
    if (moderation !== null && now >= nextModerationAt) {
      nextModerationAt = now + moderationPollMs;
      try {
        moderationResult = await moderation.tick();
      } catch (error) {
        console.error(`[Reddit moderation] tick failed: ${safeError(error)}`);
      }
    }
    let projectionResult = null;
    if (communityProjection !== null) {
      try {
        projectionResult = await communityProjection.tick();
      } catch (error) {
        console.error(`[Reddit reputation] community projection failed: ${safeError(error)}`);
      }
    }
    let mirror = null;
    if (postMirror !== null && now >= nextMirrorAt) {
      nextMirrorAt = now + mirrorPollMs;
      try {
        mirror = await postMirror.tick();
      } catch (error) {
        console.error(`[Reddit post mirror] tick failed: ${safeError(error)}`);
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
    if (dmResult !== null && (
      dmResult.inspected > 0
      || dmResult.replies > 0
      || dmResult.apologies > 0
      || dmResult.recovered > 0
      || dmResult.uncertain > 0
      || dmResult.failed > 0
    )) {
      console.log(
        `[Reddit DM] inspected=${dmResult.inspected} moderated=${dmResult.moderated} replies=${dmResult.replies} noReply=${dmResult.noReply} apologies=${dmResult.apologies} recovered=${dmResult.recovered} uncertain=${dmResult.uncertain} skipped=${dmResult.skipped} failed=${dmResult.failed}`,
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
    if (projectionResult !== null && (projectionResult.applied > 0 || projectionResult.failed > 0)) {
      console.log(
        `[Reddit reputation] r/${canonicalTargetSubreddit} projection applied=${projectionResult.applied} failed=${projectionResult.failed}`,
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
  console.log(`Mae Reddit publishing remains in single-subreddit mode for r/${redditCfg.primarySubreddit}.`);
  console.log('Cross-subreddit publishing and post mirroring remain disabled until the post-bootstrap primary cutover.');
} else {
  console.log(`Mae Reddit Twitter consumer, weekly Daily Task relay and bidirectional post mirror starting for r/${redditCfg.primarySubreddit} ⇄ r/${redditCfg.sourceSubreddit}.`);
}
if (moderation === null) {
  console.log('LLM Reddit moderation and internal reputation are disabled by REDDIT_MODERATION_ENABLED.');
} else {
  console.log(
    `LLM post/comment/modmail moderation and one canonical reputation store are enabled for ${moderationCommunities.map(value => `r/${value}`).join(' + ')}.`,
  );
}
if (directMessages === null) {
  console.log('Mae Reddit direct-message conversation handling is disabled by REDDIT_DM_ENABLED.');
}
console.log(
  `Reddit API polling cadence: moderation=${moderationPollMs}ms modmail=${modmailPollMs}ms dm=${dmPollMs}ms mirror=${mirrorPollMs}ms; shared quota gate caps Data API traffic at 1 request/second.`,
);

if (privateModmail !== null) {
  const seeded = await privateModmail.bootstrap();
  console.log(`Private modmail moderation activation boundary established; existing relay events skipped=${seeded}.`);
}
if (directMessages !== null) {
  const seeded = await directMessages.bootstrap();
  console.log(`Reddit DM activation boundary established; historic incoming direct messages skipped=${seeded}.`);
}
if (communityProjection !== null) {
  const primed = await communityProjection.tick();
  console.log(
    `Initial r/${canonicalTargetSubreddit} reputation projection applied=${primed.applied} failed=${primed.failed}.`,
  );
}
if (postMirror !== null) {
  await postMirror.tick();
  nextMirrorAt = Date.now() + mirrorPollMs;
}
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
