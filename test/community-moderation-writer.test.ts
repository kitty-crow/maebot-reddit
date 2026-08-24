import { describe, expect, test } from 'bun:test';
import { CommunityModerationWriter } from '../src/mod/communityWriter.ts';
import type { ModerationWriter } from '../src/mod/runtime.ts';

class FixtureWriter implements ModerationWriter {
  public readonly muted: string[] = [];
  public readonly unmuted: string[] = [];
  public readonly bans: string[] = [];
  public async setUserFlairTemplate(): Promise<void> {}
  public async remove(): Promise<void> {}
  public async banUser(subreddit: string, username: string): Promise<void> {
    this.bans.push(`${subreddit}:${username}`);
  }
  public async sendPrivateMessage(): Promise<void> {}
  public async muteUser(subreddit: string, username: string): Promise<void> {
    this.muted.push(`${subreddit}:${username}`);
  }
  public async unmuteUser(subreddit: string, username: string): Promise<void> {
    this.unmuted.push(`${subreddit}:${username}`);
  }
}

describe('cross-community moderation writer', () => {
  test('fans canonical communication restrictions to both communities exactly once', async () => {
    const base = new FixtureWriter();
    const writer = new CommunityModerationWriter(base, ['catgirlcoin', 'nyaonearth', 'CatgirlCoin']);

    await writer.muteUser('catgirlcoin', 'Alice', 'policy');
    await writer.unmuteUser('catgirlcoin', 'Alice');

    expect(base.muted).toEqual(['catgirlcoin:Alice', 'nyaonearth:Alice']);
    expect(base.unmuted).toEqual(['catgirlcoin:Alice', 'nyaonearth:Alice']);
  });

  test('leaves per-subreddit bans to the moderation runtime loop', async () => {
    const base = new FixtureWriter();
    const writer = new CommunityModerationWriter(base, ['catgirlcoin', 'nyaonearth']);
    await writer.banUser('nyaonearth', 'Alice', 'reason', 'note');
    expect(base.bans).toEqual(['nyaonearth:Alice']);
  });
});
