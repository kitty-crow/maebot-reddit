import { describe, expect, test } from 'bun:test';
import type { RedditAuthCfg } from '../src/env.ts';
import {
  redditAnnouncementAuth,
  twitterRedditPublishingIdentity,
} from '../src/twitter/publishingAuth.ts';

const mae: RedditAuthCfg = {
  clientId: 'shared-client',
  clientSecret: 'shared-secret',
  username: 'this_is_the_mae',
  password: 'mae-password',
  userAgent: 'mae-agent',
};

describe('Reddit publishing identities', () => {
  test('routes only Daily Task-worthy Twitter posts through the announcement identity', () => {
    expect(twitterRedditPublishingIdentity(false)).toBe('mae');
    expect(twitterRedditPublishingIdentity(true)).toBe('announcement');
    expect(() => twitterRedditPublishingIdentity(null)).toThrow('completed Daily Task classification');
  });

  test('announcement identity reuses Mae script-app OAuth credentials', () => {
    const auth = redditAnnouncementAuth(mae, {
      REDDIT_ANNOUNCEMENT_USERNAME: 'moderator',
      REDDIT_ANNOUNCEMENT_PASSWORD: 'moderator-password',
      REDDIT_ANNOUNCEMENT_USER_AGENT: 'moderator-agent',
    });

    expect(auth).toEqual({
      clientId: mae.clientId,
      clientSecret: mae.clientSecret,
      username: 'moderator',
      password: 'moderator-password',
      userAgent: 'moderator-agent',
    });
  });

  test('builds a dedicated announcement user-agent when none is configured', () => {
    const auth = redditAnnouncementAuth(mae, {
      REDDIT_ANNOUNCEMENT_USERNAME: 'moderator',
      REDDIT_ANNOUNCEMENT_PASSWORD: 'moderator-password',
    });

    expect(auth.userAgent).toContain('(by /u/moderator)');
    expect(auth.userAgent).not.toBe(mae.userAgent);
  });

  test('fails closed when announcement account credentials are absent', () => {
    expect(() => redditAnnouncementAuth(mae, {})).toThrow('REDDIT_ANNOUNCEMENT_USERNAME');
    expect(() => redditAnnouncementAuth(mae, {
      REDDIT_ANNOUNCEMENT_USERNAME: 'moderator',
    })).toThrow('REDDIT_ANNOUNCEMENT_PASSWORD');
  });
});
