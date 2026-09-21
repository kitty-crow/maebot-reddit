import type { RedditAuthCfg } from '../env.ts';

export type TwitterRedditPublishingIdentity = 'mae';

export const twitterRedditPublishingIdentity = (
  _worthy: boolean | null,
): TwitterRedditPublishingIdentity => 'mae';

export const redditAnnouncementAuth = (
  mae: RedditAuthCfg,
): RedditAuthCfg => mae;
