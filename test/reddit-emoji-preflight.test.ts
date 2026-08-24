import { describe, expect, test } from 'bun:test';
import { emojiClonePreflight, type EmojiPreflightReader } from '../src/emoji/preflight.ts';
import type { RedditEmoji } from '../src/reddit/emoji.ts';
import type { RedditAccount, RedditModerator } from '../src/reddit/types.ts';

const account: RedditAccount = {
  id: 't2_operator',
  name: 'kitty-main',
  createdUtc: null,
  linkKarma: null,
  commentKarma: null,
};

const emoji: RedditEmoji = {
  name: 'mae',
  url: 'https://emoji.redditmedia.com/hash_t5_test/mae.png',
  modFlairOnly: false,
  postFlairAllowed: true,
  userFlairAllowed: true,
};

const moderator = (permissions: readonly string[]): RedditModerator => ({
  name: account.name,
  id: account.id,
  permissions,
});

const requirements = [
  { subreddit: 'catgirlcoin', requireManageSettings: false },
  { subreddit: 'nyaonearth', requireManageSettings: true },
] as const;

describe('Reddit emoji clone pre-flight', () => {
  test('passes when source is readable/moderated and target has Manage Settings', async () => {
    const read: EmojiPreflightReader = {
      me: async () => account,
      moderators: async subreddit => subreddit === 'catgirlcoin'
        ? [moderator(['flair'])]
        : [moderator(['config'])],
      emojis: async () => [emoji],
    };

    const result = await emojiClonePreflight(read, requirements);

    expect(result.passed).toBe(true);
    expect(result.communities[0]?.manageSettings).toBe(false);
    expect(result.communities[0]?.manageSettingsRequired).toBe(false);
    expect(result.communities[0]?.passed).toBe(true);
    expect(result.communities[1]?.manageSettings).toBe(true);
    expect(result.communities[1]?.manageSettingsRequired).toBe(true);
    expect(result.communities[1]?.passed).toBe(true);
  });

  test('fails when target Manage Settings is missing', async () => {
    const read: EmojiPreflightReader = {
      me: async () => account,
      moderators: async () => [moderator(['flair'])],
      emojis: async () => [emoji],
    };

    const result = await emojiClonePreflight(read, requirements);

    expect(result.passed).toBe(false);
    expect(result.communities[1]?.failures).toContain('Manage Settings (`config`) is required but missing');
  });

  test('fails when the authenticated account is not a moderator in either community', async () => {
    const read: EmojiPreflightReader = {
      me: async () => account,
      moderators: async subreddit => subreddit === 'catgirlcoin' ? [] : [moderator(['config'])],
      emojis: async () => [emoji],
    };

    const result = await emojiClonePreflight(read, requirements);

    expect(result.passed).toBe(false);
    expect(result.communities[0]?.moderator).toBe(false);
    expect(result.communities[0]?.failures).toContain('u/kitty-main is not a moderator');
  });

  test('fails when either custom emoji inventory cannot be read', async () => {
    const read: EmojiPreflightReader = {
      me: async () => account,
      moderators: async () => [moderator(['all'])],
      emojis: async subreddit => {
        if (subreddit === 'nyaonearth') throw new Error('forbidden');
        return [emoji];
      },
    };

    const result = await emojiClonePreflight(read, requirements);

    expect(result.passed).toBe(false);
    expect(result.communities[1]?.emojiInventoryReadable).toBe(false);
    expect(result.communities[1]?.failures[0]).toContain('custom emoji inventory failed');
  });
});
