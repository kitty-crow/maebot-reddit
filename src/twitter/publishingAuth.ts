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
  const username = required(environment, 'REDDIT_ANNOUNCEMENT_USERNAME');
  return {
    // The moderator account is a developer of Mae's existing Reddit script app,
    // so both identities deliberately share one OAuth app and one quota budget.
    clientId: mae.clientId,
    clientSecret: mae.clientSecret,
    username,
    password: required(environment, 'REDDIT_ANNOUNCEMENT_PASSWORD'),
    userAgent: optional(environment, 'REDDIT_ANNOUNCEMENT_USER_AGENT')
      ?? `linux:com.kittycrow.maebot-reddit:announcement:0.1.0 (by /u/${username})`,
  };
};
