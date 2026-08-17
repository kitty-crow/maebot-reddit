import 'dotenv/config';
import { resolve } from 'node:path';

const req = (name: string): string => {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
};

const opt = (name: string, fallback: string): string => process.env[name]?.trim() || fallback;

const community = (name: string, fallback: string): string => {
  const value = opt(name, fallback).replace(/^r\//iu, '').trim();
  if (!/^[A-Za-z0-9_]{2,21}$/u.test(value)) throw new Error(`${name} is not a valid subreddit name`);
  return value;
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
