import type { RedditAuthCfg } from '../env.ts';

type PublishingEnv = Readonly<Record<string, string | undefined>>;

const optional = (environment: PublishingEnv, name: string): string | null => {
  const value = environment[name]?.trim();
  return value === undefined || value.length === 0 ? null : value;
};

const required = (environment: PublishingEnv, name: string): string => {
  const value = optional(environment, name);
  if (value === null) throw new Error(`${name} is required for Daily Task-worthy Reddit announcements`);
  return value;
};

export type TwitterRedditPublishingIdentity = 'mae' | 'announcement';

export const twitterRedditPublishingIdentity = (
  worthy: boolean | null,
): TwitterRedditPublishingIdentity => {
  if (worthy === null) {
    throw new Error('Twitter Reddit publishing identity requires a completed Daily Task classification');
  }
  return worthy ? 'announcement' : 'mae';
};

export const redditAnnouncementAuth = (
  mae: RedditAuthCfg,
  environment: PublishingEnv = process.env,
): RedditAuthCfg => {
  const base = mae.legacyOauth ?? null;
  if (base === null) {
    throw new Error('Legacy Reddit OAuth fallback must be configured for main-account announcements');
  }
  const username = required(environment, 'REDDIT_ANNOUNCEMENT_USERNAME');
  return {
    username,
    devvitRpcStateFile: mae.devvitRpcStateFile,
    devvitRpcTimeoutMs: mae.devvitRpcTimeoutMs,
    transport: 'legacy',
    legacyOauth: {
      clientId: base.clientId,
      clientSecret: base.clientSecret,
      password: required(environment, 'REDDIT_ANNOUNCEMENT_PASSWORD'),
      userAgent: optional(environment, 'REDDIT_ANNOUNCEMENT_USER_AGENT')
        ?? `linux:com.kittycrow.maebot-reddit:announcement:0.1.0 (by /u/${username})`,
    },
  };
};
