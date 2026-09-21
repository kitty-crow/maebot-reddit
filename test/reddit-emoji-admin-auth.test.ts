import { describe, expect, test } from 'bun:test';
import type { RedditAuthCfg } from '../src/env.ts';
import { redditEmojiAdminAuth } from '../src/reddit/emojiAdminAuth.ts';

const mae: RedditAuthCfg = {
  username: 'this_is_the_mae',
  devvitRpcStateFile: '/tmp/mae-emoji-admin-test.pb',
  devvitRpcTimeoutMs: 1_000,
  transport: 'devvit',
  legacyOauth: {
    clientId: 'mae-client',
    clientSecret: 'mae-secret',
    password: 'mae-password',
    userAgent: 'mae-agent',
  },
};

describe('Reddit emoji admin auth', () => {
  test('uses explicit admin identity over the legacy Reddit fallback', () => {
    expect(redditEmojiAdminAuth(mae, {
      username: 'kitty-main',
      password: 'admin-password',
    })).toEqual({
      username: 'kitty-main',
      devvitRpcStateFile: mae.devvitRpcStateFile,
      devvitRpcTimeoutMs: mae.devvitRpcTimeoutMs,
      transport: 'legacy',
      legacyOauth: {
        clientId: 'mae-client',
        clientSecret: 'mae-secret',
        password: 'admin-password',
        userAgent: 'linux:com.kittycrow.maebot-reddit:emoji-migration:0.1.0 (by /u/kitty-main)',
      },
    });
  });

  test('rejects missing interactive credentials', () => {
    expect(() => redditEmojiAdminAuth(mae, {
      username: '   ',
      password: 'admin-password',
    })).toThrow('username is required');
    expect(() => redditEmojiAdminAuth(mae, {
      username: 'kitty-main',
      password: '',
    })).toThrow('password is required');
  });
});
