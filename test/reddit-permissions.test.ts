import { describe, expect, test } from 'bun:test';
import { assertModeratorPermissions } from '../src/reddit/permissions.ts';
import type { RedditModerator } from '../src/reddit/types.ts';

const moderator = (
  name: string,
  permissions: readonly string[],
): RedditModerator => ({
  name,
  id: null,
  permissions,
});

describe('Reddit moderator migration permissions', () => {
  test('accepts explicit Manage Settings config permission', () => {
    expect(() => assertModeratorPermissions(
      'this_is_the_mae',
      'nyaonearth',
      [moderator('this_is_the_mae', ['access', 'config', 'flair', 'mail', 'posts'])],
      ['config'],
    )).not.toThrow();
  });

  test('accepts all permission for emoji migration', () => {
    expect(() => assertModeratorPermissions(
      'this_is_the_mae',
      'nyaonearth',
      [moderator('this_is_the_mae', ['all'])],
      ['config'],
    )).not.toThrow();
  });

  test('normalises Reddit permission names before comparison', () => {
    expect(() => assertModeratorPermissions(
      'THIS_IS_THE_MAE',
      'nyaonearth',
      [moderator('this_is_the_mae', ['CONFIG'])],
      ['config'],
    )).not.toThrow();
  });

  test('rejects flair-only moderator before emoji migration', () => {
    expect(() => assertModeratorPermissions(
      'this_is_the_mae',
      'nyaonearth',
      [moderator('this_is_the_mae', ['access', 'flair', 'mail', 'posts'])],
      ['config'],
    )).toThrow('missing required moderator permissions in r/nyaonearth: config');
  });
});
