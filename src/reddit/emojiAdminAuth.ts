import type { RedditAuthCfg } from '../env.ts';

export type RedditCredentials = {
  readonly username: string;
  readonly password: string;
};

export const redditEmojiAdminAuth = (
  fallback: RedditAuthCfg,
  credentials: RedditCredentials,
): RedditAuthCfg => {
  const legacy = fallback.legacyOauth ?? null;
  if (legacy === null) throw new Error('Legacy Reddit OAuth fallback is required for emoji administration');

  const username = credentials.username.trim();
  if (username.length === 0) throw new Error('Reddit emoji admin username is required');
  if (credentials.password.length === 0) throw new Error('Reddit emoji admin password is required');

  return {
    username,
    devvitRpcStateFile: fallback.devvitRpcStateFile,
    devvitRpcTimeoutMs: fallback.devvitRpcTimeoutMs,
    transport: 'legacy',
    legacyOauth: {
      clientId: legacy.clientId,
      clientSecret: legacy.clientSecret,
      password: credentials.password,
      userAgent: `linux:com.kittycrow.maebot-reddit:emoji-migration:0.1.0 (by /u/${username})`,
    },
  };
};
