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
  test('uses interactive admin credentials while retaining Mae OAuth app credentials', () => {
    expect(redditEmojiAdminAuth(mae, {
      username: 'kitty-main',
      password: 'admin-password',
    })).toEqual({
      clientId: 'mae-client',
      clientSecret: 'mae-secret',
      username: 'kitty-main',
      password: 'admin-password',
      userAgent: 'linux:com.kittycrow.maebot-reddit:emoji-migration:0.1.0 (by /u/kitty-main)',
    });
  });

  test('normalises username whitespace but preserves the password exactly', () => {
    const auth = redditEmojiAdminAuth(mae, {
      username: '  kitty-main  ',
      password: '  secret with spaces  ',
    });
    expect(auth.username).toBe('kitty-main');
    expect(auth.password).toBe('  secret with spaces  ');
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
