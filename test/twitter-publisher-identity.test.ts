import { describe, expect, test } from 'bun:test';
import type { RedditAuthCfg } from '../src/env.ts';
import {
  redditAnnouncementAuth,
  twitterRedditPublishingIdentity,
} from '../src/twitter/publishingAuth.ts';

const mae: RedditAuthCfg = {
  username: 'this_is_the_mae',
  devvitRpcStateFile: '/tmp/mae-publisher-identity-test.pb',
  devvitRpcTimeoutMs: 1_000,
  transport: 'devvit',
  legacyOauth: {
    clientId: 'shared-client',
    clientSecret: 'shared-secret',
    password: 'mae-password',
    userAgent: 'mae-agent',
  },
};

describe('Reddit publishing identities', () => {
  test('preserves the current Mae versus main-announcement split', () => {
    expect(twitterRedditPublishingIdentity(false)).toBe('mae');
    expect(twitterRedditPublishingIdentity(true)).toBe('announcement');
    expect(() => twitterRedditPublishingIdentity(null)).toThrow('completed Daily Task classification');
  });

  test('main announcements reuse the existing OAuth app but force legacy transport', () => {
    const auth = redditAnnouncementAuth(mae, {
      REDDIT_ANNOUNCEMENT_USERNAME: 'moderator',
      REDDIT_ANNOUNCEMENT_PASSWORD: 'moderator-password',
      REDDIT_ANNOUNCEMENT_USER_AGENT: 'moderator-agent',
    });

    expect(auth).toEqual({
      username: 'moderator',
      devvitRpcStateFile: mae.devvitRpcStateFile,
      devvitRpcTimeoutMs: mae.devvitRpcTimeoutMs,
      transport: 'legacy',
      legacyOauth: {
        clientId: 'shared-client',
        clientSecret: 'shared-secret',
        password: 'moderator-password',
        userAgent: 'moderator-agent',
      },
    });
  });

  test('fails closed if main-account announcement credentials are absent', () => {
    expect(() => redditAnnouncementAuth(mae, {})).toThrow('REDDIT_ANNOUNCEMENT_USERNAME');
  });
});
