import { describe, expect, test } from 'bun:test';
import { reputationDesiredMutes, reputationMuteEffects } from '../src/reputation/muteReconcile.ts';

const now = 1_000_000;
const seededAtSeconds = 900;
const seededAtMs = seededAtSeconds * 1_000;
const sevenDaysMs = 7 * 24 * 60 * 60 * 1_000;

describe('legacy reputation mute reconciliation', () => {
  test('a pre-discipline snapshot derives communication restrictions from canonical statuses', () => {
    const raw = {
      schema: 1,
      subreddit: 'catgirlcoin',
      bootstrappedAt: 123,
      users: {
        banned: { username: 'BannedUser', status: 'banned', seededAt: seededAtSeconds },
        scam: { username: 'ScamUser', status: 'scam', seededAt: seededAtSeconds },
        uncivil: { username: 'UncivilUser', status: 'uncivil', seededAt: seededAtSeconds },
        ordinary: { username: 'OrdinaryUser', status: 'ordinary', seededAt: seededAtSeconds },
      },
    };

    expect(reputationDesiredMutes(raw, now)).toEqual([
      { username: 'BannedUser', muteUntil: null, permanent: true },
      { username: 'OrdinaryUser', muteUntil: null, permanent: false },
      { username: 'ScamUser', muteUntil: null, permanent: true },
      { username: 'UncivilUser', muteUntil: seededAtMs + sevenDaysMs, permanent: false },
    ]);

    expect(reputationMuteEffects(raw, now)).toEqual([
      { username: 'BannedUser', action: 'mute', note: 'Mae permanent reputation enforcement' },
      { username: 'ScamUser', action: 'mute', note: 'Mae permanent reputation enforcement' },
      { username: 'UncivilUser', action: 'mute', note: 'Mae uncivil reputation state' },
    ]);

    expect(reputationDesiredMutes(raw, now + 10_000)[3]).toEqual({
      username: 'UncivilUser',
      muteUntil: seededAtMs + sevenDaysMs,
      permanent: false,
    });
  });

  test('a present malformed discipline field still fails closed', () => {
    const raw = {
      users: {
        banned: { username: 'BannedUser', status: 'banned' },
      },
      discipline: 'corrupt',
    };

    expect(() => reputationDesiredMutes(raw, now)).toThrow('discipline map is invalid');
  });
});
