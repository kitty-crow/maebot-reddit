import type { RedditAuthCfg } from '../env.ts';

type Environment = Readonly<Record<string, string | undefined>>;

const maybe = (environment: Environment, name: string): string | null => {
  const value = environment[name]?.trim();
  return value === undefined || value.length === 0 ? null : value;
};

const required = (environment: Environment, name: string): string => {
  const value = maybe(environment, name);
  if (value === null) throw new Error(`${name} is required for custom emoji migration`);
  return value;
};

export const redditEmojiAdminAuth = (
  fallback: RedditAuthCfg,
  environment: Environment = process.env,
): RedditAuthCfg => {
  const username = required(environment, 'REDDIT_EMOJI_ADMIN_USERNAME');
  const password = required(environment, 'REDDIT_EMOJI_ADMIN_PASSWORD');
  const clientId = maybe(environment, 'REDDIT_EMOJI_ADMIN_CLIENT_ID');
  const clientSecret = maybe(environment, 'REDDIT_EMOJI_ADMIN_CLIENT_SECRET');

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
    userAgent: maybe(environment, 'REDDIT_EMOJI_ADMIN_USER_AGENT')
      ?? `linux:com.kittycrow.maebot-reddit:emoji-migration:0.1.0 (by /u/${username})`,
  };
};
