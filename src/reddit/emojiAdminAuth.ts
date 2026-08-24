import type { RedditAuthCfg } from '../env.ts';

const maybe = (name: string): string | null => {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? null : value;
};

const required = (name: string): string => {
  const value = maybe(name);
  if (value === null) throw new Error(`${name} is required for custom emoji migration`);
  return value;
};

export const redditEmojiAdminAuth = (fallback: RedditAuthCfg): RedditAuthCfg => {
  const username = required('REDDIT_EMOJI_ADMIN_USERNAME');
  const password = required('REDDIT_EMOJI_ADMIN_PASSWORD');
  const clientId = maybe('REDDIT_EMOJI_ADMIN_CLIENT_ID');
  const clientSecret = maybe('REDDIT_EMOJI_ADMIN_CLIENT_SECRET');

  if ((clientId === null) !== (clientSecret === null)) {
    throw new Error(
      'REDDIT_EMOJI_ADMIN_CLIENT_ID and REDDIT_EMOJI_ADMIN_CLIENT_SECRET must be configured together',
    );
  }

  return {
    clientId: clientId ?? fallback.clientId,
    clientSecret: clientSecret ?? fallback.clientSecret,
    username,
    password,
    userAgent: maybe('REDDIT_EMOJI_ADMIN_USER_AGENT')
      ?? `linux:com.kittycrow.maebot-reddit:emoji-migration:0.1.0 (by /u/${username})`,
  };
};
