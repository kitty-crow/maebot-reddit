import type { RedditAuthCfg } from '../env.ts';

export type RedditCredentials = {
  readonly username: string;
  readonly password: string;
};

export const redditEmojiAdminAuth = (
  fallback: RedditAuthCfg,
  _credentials: RedditCredentials,
): RedditAuthCfg => fallback;
