import 'dotenv/config';
import { resolve } from 'node:path';
import type { ModerationAiCfg } from './mod/classifier.ts';

const req = (name: string): string => {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
};

const maybe = (name: string): string | null => {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? null : value;
};

const opt = (name: string, fallback: string): string => process.env[name]?.trim() || fallback;
const alias = (name: string, legacy: string): string => maybe(name) ?? req(legacy);

const community = (name: string, fallback: string): string => {
  const value = opt(name, fallback).replace(/^r\//iu, '').trim();
  if (!/^[A-Za-z0-9_]{2,21}$/u.test(value)) throw new Error(`${name} is not a valid subreddit name`);
  return value;
};

const port = (name: string, value: string): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} must be a TCP port from 1 to 65535`);
  }
  return parsed;
};

const loopbackHost = (name: string, fallback = '127.0.0.1'): string => {
  const value = opt(name, fallback);
  const canonical = value.toLowerCase();
  if (canonical !== '127.0.0.1' && canonical !== '::1' && canonical !== 'localhost') {
    throw new Error(`${name} must be a loopback host`);
  }
  return value;
};

const positive = (name: string, fallback: string): number => {
  const parsed = Number(opt(name, fallback));
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
};

const enabled = (name: string): boolean => {
  const raw = maybe(name)?.toLowerCase() ?? 'false';
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  throw new Error(`${name} must be true or false`);
};

const effort = (name: string, fallback: ModerationAiCfg['effort']): ModerationAiCfg['effort'] => {
  const value = opt(name, fallback);
  if (value === 'none' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max') return value;
  throw new Error(`${name} is not a supported reasoning effort`);
};

export type RedditAuthCfg = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly username: string;
  readonly password: string;
  readonly userAgent: string;
};

export type RedditCfg = {
  readonly auth: RedditAuthCfg;
  readonly sourceSubreddit: string;
  readonly primarySubreddit: string;
  readonly stateFile: string;
};

export type RedditModerationCfg = {
  readonly ai: ModerationAiCfg;
  readonly stateFile: string;
  readonly batchSize: number;
  readonly scoreBatchSize: number;
  readonly flairReconcileMs: number;
};

export type RedditDmCfg = {
  readonly replyAi: ModerationAiCfg;
  readonly persona: string;
  readonly stateFile: string;
  readonly batchSize: number;
};

export type LoopbackApiCfg = {
  readonly base: string;
  readonly token: string;
};

export type InternalApiCfg = {
  readonly host: string;
  readonly port: number;
  readonly token: string;
};

export const redditConfig = (): RedditCfg => ({
  auth: {
    // Preserve the production Python deployment's credential names so the
    // cutover does not require copying secrets into Git or re-entering them.
    clientId: maybe('REDDIT_CLIENT_ID') ?? 'GPs6wxXUncfEVH6wAn2KSQ',
    clientSecret: alias('REDDIT_CLIENT_SECRET', 'GPs6wxXUncfEVH6wAn2KSQ'),
    username: maybe('REDDIT_USERNAME') ?? 'this_is_the_mae',
    password: alias('REDDIT_PASSWORD', 'this_is_the_mae'),
    userAgent: maybe('REDDIT_USER_AGENT') ?? 'linux:com.kittycrow.maebot-reddit:0.1.0 (by /u/this_is_the_mae)',
  },
  sourceSubreddit: community('REDDIT_SOURCE_SUBREDDIT', 'catgirlcoin'),
  primarySubreddit: community('REDDIT_PRIMARY_SUBREDDIT', 'nyaonearth'),
  stateFile: resolve(process.cwd(), opt('REDDIT_STATE_FILE', 'data/reddit.pb')),
});

export const redditModerationConfig = (): RedditModerationCfg | null => {
  if (!enabled('REDDIT_MODERATION_ENABLED')) return null;
  return {
    ai: {
      key: req('OPENAI_API_KEY'),
      model: req('REDDIT_MODERATION_MODEL'),
      effort: effort('REDDIT_MODERATION_EFFORT', 'low'),
    },
    stateFile: resolve(process.cwd(), opt('REDDIT_REPUTATION_STATE_FILE', 'data/reputation.pb')),
    batchSize: Math.min(100, positive('REDDIT_MODERATION_BATCH_SIZE', '100')),
    scoreBatchSize: Math.min(100, positive('REDDIT_SCORE_BATCH_SIZE', '100')),
    flairReconcileMs: positive('REDDIT_FLAIR_RECONCILE_MS', '300000'),
  };
};

export const redditDmConfig = (): RedditDmCfg | null => {
  if (!enabled('REDDIT_DM_ENABLED')) return null;
  return {
    replyAi: {
      key: req('OPENAI_API_KEY'),
      model: opt('REDDIT_DM_MODEL', 'gpt-5.6-luna'),
      effort: effort('REDDIT_DM_EFFORT', 'low'),
    },
    persona: req('REDDIT_MAE_PERSONA'),
    stateFile: resolve(process.cwd(), opt('REDDIT_DM_STATE_FILE', 'data/directMessages.pb')),
    batchSize: Math.min(100, positive('REDDIT_DM_BATCH_SIZE', '100')),
  };
};

export const twitterApiConfig = (): LoopbackApiCfg => ({
  base: req('TWITTER_API_URL'),
  token: req('TWITTER_API_TOKEN'),
});

export const dailyReviewApiConfig = (): LoopbackApiCfg => ({
  base: req('DAILY_REVIEW_API_URL'),
  token: req('DAILY_REVIEW_API_TOKEN'),
});

export const internalApiConfig = (): InternalApiCfg | null => {
  const token = maybe('REDDIT_INTERNAL_API_TOKEN');
  const rawPort = maybe('REDDIT_INTERNAL_API_PORT');
  if (token === null && rawPort === null) return null;
  if (token === null || rawPort === null) {
    throw new Error('REDDIT_INTERNAL_API_TOKEN and REDDIT_INTERNAL_API_PORT must be configured together');
  }
  return {
    host: loopbackHost('REDDIT_INTERNAL_API_HOST'),
    port: port('REDDIT_INTERNAL_API_PORT', rawPort),
    token,
  };
};
