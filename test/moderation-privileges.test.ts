import { describe, expect, test } from 'bun:test';
import { ModerationPrivileges } from '../src/mod/privileges.ts';
import type { RedditAccount, RedditModerator } from '../src/reddit/types.ts';

class Reader {
  public moderatorNames = ['NewModerator'];
  public calls = 0;

  public async me(): Promise<RedditAccount> {
    return { id: 'mae', name: 'this_is_the_mae', createdUtc: 1, linkKarma: 0, commentKarma: 0 };
  }

  public async moderators(): Promise<readonly RedditModerator[]> {
    this.calls += 1;
    return this.moderatorNames.map((name, index) => ({ name, id: `m${index}`, permissions: ['all'] }));
  }
}

describe('live Reddit moderation privileges', () => {
  test('exempts Mae and current Reddit moderators case-insensitively', async () => {
    const reader = new Reader();
    const privileges = new ModerationPrivileges('catgirlcoin', reader);
    expect(await privileges.exemption('THIS_IS_THE_MAE')).toBe('bot');
    expect(await privileges.exemption('newmoderator')).toBe('moderator');
    expect(await privileges.exemption('OrdinaryUser')).toBeNull();
    expect(reader.calls).toBe(1);
  });

  test('can invalidate cached privileges when a roster refresh is required', async () => {
    const reader = new Reader();
    const privileges = new ModerationPrivileges('catgirlcoin', reader);
    expect(await privileges.exemption('NewModerator')).toBe('moderator');
    reader.moderatorNames = ['ReplacementModerator'];
    expect(await privileges.exemption('ReplacementModerator')).toBeNull();
    privileges.invalidate();
    expect(await privileges.exemption('ReplacementModerator')).toBe('moderator');
    expect(reader.calls).toBe(2);
  });
});