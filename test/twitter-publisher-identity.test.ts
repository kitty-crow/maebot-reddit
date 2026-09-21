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
};

describe('Reddit publishing identity', () => {
  test('all automated Reddit publishing uses the Devvit app account', () => {
    expect(twitterRedditPublishingIdentity(false)).toBe('mae');
    expect(twitterRedditPublishingIdentity(true)).toBe('mae');
    expect(twitterRedditPublishingIdentity(null)).toBe('mae');
  });

  test('announcement auth is the same Devvit-backed Mae identity', () => {
    expect(redditAnnouncementAuth(mae)).toBe(mae);
  });
});
