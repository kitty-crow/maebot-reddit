import type { RedditAuthCfg } from '../env.ts';

export type RedditCredentials = {
  readonly username: string;
  readonly password: string;
};

export const redditEmojiAdminAuth = (
  fallback: RedditAuthCfg,
  credentials: RedditCredentials,
): RedditAuthCfg => {
  const username = credentials.username.trim();
  if (username.length === 0) throw new Error('Reddit emoji admin username is required');
  if (credentials.password.length === 0) throw new Error('Reddit emoji admin password is required');

  return {
    clientId: fallback.clientId,
    clientSecret: fallback.clientSecret,
    username,
    password: credentials.password,
    userAgent: `linux:com.kittycrow.maebot-reddit:emoji-migration:0.1.0 (by /u/${username})`,
  };
};
