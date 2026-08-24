import { describe, expect, test } from 'bun:test';
import { downloadEmojiAsset, emojiCloneAction, unresolvedEmojiClone } from '../src/emoji/clone.ts';
import { redditEmojiUploadLease, redditEmojis, type RedditEmoji } from '../src/reddit/emoji.ts';

const emoji = (
  name: string,
  overrides: Partial<RedditEmoji> = {},
): RedditEmoji => ({
  name,
  url: `https://emoji.redditmedia.com/hash_t5_test/${name}.png`,
  modFlairOnly: false,
  postFlairAllowed: true,
  userFlairAllowed: true,
  ...overrides,
});

describe('Reddit custom emoji decoding and clone planning', () => {
  test('decodes only the subreddit custom emoji map and preserves permissions', () => {
    const decoded = redditEmojis({
      snoomojis: {
        wave: { url: 'https://example.invalid/wave.png' },
      },
      t5_source: {
        zeta: {
          url: 'https://emoji.redditmedia.com/z_t5_source/zeta.png',
          mod_flair_only: true,
          post_flair_allowed: false,
          user_flair_allowed: true,
        },
        alpha: {
          url: 'https://emoji.redditmedia.com/a_t5_source/alpha.png',
          mod_flair_only: false,
          post_flair_allowed: true,
          user_flair_allowed: true,
        },
      },
    });

    expect(decoded.map(value => value.name)).toEqual(['alpha', 'zeta']);
    expect(decoded[1]).toEqual({
      name: 'zeta',
      url: 'https://emoji.redditmedia.com/z_t5_source/zeta.png',
      modFlairOnly: true,
      postFlairAllowed: false,
      userFlairAllowed: true,
    });
  });

  test('decodes an S3 emoji upload lease without trusting non-HTTPS actions', () => {
    const lease = redditEmojiUploadLease({
      s3UploadLease: {
        action: '//reddit-emoji-upload.s3.amazonaws.com',
        fields: [
          { name: 'key', value: 'nyaonearth/hash' },
          { name: 'policy', value: 'signed-policy' },
        ],
      },
    });
    expect(lease.uploadUrl).toBe('https://reddit-emoji-upload.s3.amazonaws.com/');
    expect(lease.key).toBe('nyaonearth/hash');
    expect(lease.fields.get('policy')).toBe('signed-policy');

    expect(() => redditEmojiUploadLease({
      s3UploadLease: {
        action: 'http://example.com/upload',
        fields: [{ name: 'key', value: 'bad' }],
      },
    })).toThrow('non-HTTPS');
  });

  test('plans missing and changed assets as uploads, permission drift as metadata update, and exact matches as no-op', () => {
    const source = emoji('mae');
    expect(emojiCloneAction(source, undefined, 'source', null)).toBe('upload');
    expect(emojiCloneAction(source, emoji('mae'), 'source', 'different')).toBe('upload');
    expect(emojiCloneAction(
      source,
      emoji('mae', { userFlairAllowed: false }),
      'same',
      'same',
    )).toBe('permissions');
    expect(emojiCloneAction(source, emoji('mae'), 'same', 'same')).toBe('skip');
  });

  test('verification requires every source emoji and its permissions but permits target-only emojis', () => {
    const source = [emoji('mae'), emoji('lisa')];
    expect(unresolvedEmojiClone(source, [
      emoji('mae'),
      emoji('lisa'),
      emoji('nya-only'),
    ])).toEqual([]);

    expect(unresolvedEmojiClone(source, [
      emoji('mae'),
      emoji('lisa', { postFlairAllowed: false }),
    ])).toEqual([':lisa: permissions differ']);
  });

  test('downloads only Reddit-hosted PNG/JPEG emoji assets and hashes their bytes', async () => {
    const asset = await downloadEmojiAsset(emoji('mae'), async input => {
      expect(String(input)).toContain('emoji.redditmedia.com');
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    });

    expect(asset.filename).toBe('mae.png');
    expect(asset.mimeType).toBe('image/png');
    expect(asset.bytes.byteLength).toBe(3);
    expect(asset.sha256).toHaveLength(64);

    await expect(downloadEmojiAsset(
      emoji('mae', { url: 'https://example.com/mae.png' }),
      async () => new Response(new Uint8Array([1]), { status: 200 }),
    )).rejects.toThrow('non-Reddit emoji asset URL');
  });
});
