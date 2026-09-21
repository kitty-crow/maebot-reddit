import { expect, test } from 'bun:test';
import type { RedditAuthCfg } from '../src/env.ts';
import { redditEmojiAdminAuth } from '../src/reddit/emojiAdminAuth.ts';

const mae: RedditAuthCfg = {
  username: 'this_is_the_mae',
  devvitRpcStateFile: '/tmp/mae-emoji-admin-test.pb',
  devvitRpcTimeoutMs: 1_000,
};

test('Devvit app identity remains authoritative for Reddit admin helpers', () => {
  expect(redditEmojiAdminAuth(mae, {
    username: 'kitty-main',
    password: 'admin-password',
  })).toBe(mae);
});
