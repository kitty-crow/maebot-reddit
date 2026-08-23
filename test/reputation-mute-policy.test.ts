import { describe, expect, test } from 'bun:test';
import {
  UNCIVIL_MUTE_MS,
  clearRedeemedMute,
  extendUncivilMute,
  muteRemainingMs,
  permanentMute,
} from '../src/reputation/mutePolicy.ts';

const DAY = 24 * 60 * 60 * 1_000;

describe('uncivil modmail mute policy', () => {
  test('first uncivil action creates a fresh thirty-day mute', () => {
    const now = 1_000_000;
    expect(extendUncivilMute({ muteUntil: null, permanent: false }, now))
      .toEqual({ muteUntil: now + 30 * DAY, permanent: false });
  });

  test('a new uncivil mark adds thirty days to remaining mute time', () => {
    const now = 1_000_000;
    const existing = { muteUntil: now + 4 * DAY, permanent: false };
    const next = extendUncivilMute(existing, now);
    expect(next.muteUntil).toBe(now + 34 * DAY);
    expect(muteRemainingMs(next, now)).toBe(34 * DAY);
  });

  test('an expired mute starts a new thirty-day period instead of extending the old date', () => {
    const now = 10_000_000;
    const expired = { muteUntil: now - DAY, permanent: false };
    expect(extendUncivilMute(expired, now))
      .toEqual({ muteUntil: now + UNCIVIL_MUTE_MS, permanent: false });
  });

  test('redemption clears remaining mute debt immediately', () => {
    expect(clearRedeemedMute()).toEqual({ muteUntil: null, permanent: false });
  });

  test('permanent bans produce a permanent mute that cannot be extended back to temporary', () => {
    const current = permanentMute();
    expect(current).toEqual({ muteUntil: null, permanent: true });
    expect(extendUncivilMute(current, 123)).toEqual(current);
    expect(muteRemainingMs(current, 123)).toBeNull();
  });
});
