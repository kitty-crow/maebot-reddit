import 'dotenv/config';
import { resolve } from 'node:path';

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
    clientId: req('REDDIT_CLIENT_ID'),
    clientSecret: req('REDDIT_CLIENT_SECRET'),
    username: req('REDDIT_USERNAME'),
    password: req('REDDIT_PASSWORD'),
    userAgent: req('REDDIT_USER_AGENT'),
  },
  sourceSubreddit: community('REDDIT_SOURCE_SUBREDDIT', 'catgirlcoin'),
  primarySubreddit: community('REDDIT_PRIMARY_SUBREDDIT', 'nyaonearth'),
  stateFile: resolve(process.cwd(), opt('REDDIT_STATE_FILE', 'data/reddit.pb')),
});

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
    host: opt('REDDIT_INTERNAL_API_HOST', '127.0.0.1'),
    port: port('REDDIT_INTERNAL_API_PORT', rawPort),
    token,
  };
};
