import { describe, expect, test } from 'bun:test';
import type { RedditAuthCfg } from '../src/env.ts';
import { redditEmojiAdminAuth } from '../src/reddit/emojiAdminAuth.ts';

const mae: RedditAuthCfg = {
  clientId: 'mae-client',
  clientSecret: 'mae-secret',
  username: 'this_is_the_mae',
  password: 'mae-password',
  userAgent: 'mae-agent',
};

describe('Reddit emoji admin auth', () => {
  test('uses the dedicated Reddit user while reusing Mae OAuth app credentials by default', () => {
    expect(redditEmojiAdminAuth(mae, {
      REDDIT_EMOJI_ADMIN_USERNAME: 'kitty-main',
      REDDIT_EMOJI_ADMIN_PASSWORD: 'admin-password',
    })).toEqual({
      clientId: 'mae-client',
      clientSecret: 'mae-secret',
      username: 'kitty-main',
      password: 'admin-password',
      userAgent: 'linux:com.kittycrow.maebot-reddit:emoji-migration:0.1.0 (by /u/kitty-main)',
    });
  });

  test('supports a separate OAuth app only when client id and secret are supplied together', () => {
    expect(redditEmojiAdminAuth(mae, {
      REDDIT_EMOJI_ADMIN_USERNAME: 'kitty-main',
      REDDIT_EMOJI_ADMIN_PASSWORD: 'admin-password',
      REDDIT_EMOJI_ADMIN_CLIENT_ID: 'admin-client',
      REDDIT_EMOJI_ADMIN_CLIENT_SECRET: 'admin-secret',
      REDDIT_EMOJI_ADMIN_USER_AGENT: 'admin-agent',
    })).toEqual({
      clientId: 'admin-client',
      clientSecret: 'admin-secret',
      username: 'kitty-main',
      password: 'admin-password',
      userAgent: 'admin-agent',
    });

    expect(() => redditEmojiAdminAuth(mae, {
      REDDIT_EMOJI_ADMIN_USERNAME: 'kitty-main',
      REDDIT_EMOJI_ADMIN_PASSWORD: 'admin-password',
      REDDIT_EMOJI_ADMIN_CLIENT_ID: 'admin-client',
    })).toThrow('must be configured together');
  });

  test('requires explicit admin username and password', () => {
    expect(() => redditEmojiAdminAuth(mae, {})).toThrow('REDDIT_EMOJI_ADMIN_USERNAME');
    expect(() => redditEmojiAdminAuth(mae, {
      REDDIT_EMOJI_ADMIN_USERNAME: 'kitty-main',
    })).toThrow('REDDIT_EMOJI_ADMIN_PASSWORD');
  });
});
