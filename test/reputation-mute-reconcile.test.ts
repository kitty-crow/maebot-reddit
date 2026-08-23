import { describe, expect, test } from 'bun:test';
import { reputationMuteEffects } from '../src/reputation/muteReconcile.ts';
import {
  REDDIT_MUTE_CHUNK_MS,
  REDDIT_MUTE_RENEW_LEAD_MS,
  UNCIVIL_MUTE_MS,
  redditMuteAction,
} from '../src/reputation/mutePolicy.ts';

const day = 24 * 60 * 60 * 1_000;
const start = 1_000_000;

describe('Reddit modmail mute reconciliation', () => {
  test('a new thirty-day Mae mute immediately applies Reddit first chunk', () => {
    expect(redditMuteAction(
      { muteUntil: start + UNCIVIL_MUTE_MS, permanent: false },
      { redditMuted: false, appliedAt: null },
      start,
    )).toBe('mute');
  });

  test('a thirty-day Mae mute renews the Reddit twenty-eight-day chunk only near expiry', () => {
    const desired = { muteUntil: start + UNCIVIL_MUTE_MS, permanent: false };
    const applied = { redditMuted: true, appliedAt: start };
    expect(redditMuteAction(desired, applied, start + REDDIT_MUTE_CHUNK_MS - REDDIT_MUTE_RENEW_LEAD_MS - 1)).toBeNull();
    expect(redditMuteAction(desired, applied, start + REDDIT_MUTE_CHUNK_MS - REDDIT_MUTE_RENEW_LEAD_MS)).toBe('mute');
  });

  test('Mae explicitly unmutes at her deadline even when a renewed Reddit chunk still has time left', () => {
    expect(redditMuteAction(
      { muteUntil: start + 30 * day, permanent: false },
      { redditMuted: true, appliedAt: start + 27 * day },
      start + 30 * day,
    )).toBe('unmute');
  });

  test('cumulative sixty-day debt renews again before the second Reddit chunk expires', () => {
    expect(redditMuteAction(
      { muteUntil: start + 60 * day, permanent: false },
      { redditMuted: true, appliedAt: start + 27 * day },
      start + 54 * day,
    )).toBe('mute');
  });

  test('a Reddit chunk already covering the remaining Mae deadline is not refreshed unnecessarily', () => {
    expect(redditMuteAction(
      { muteUntil: start + 20 * day, permanent: false },
      { redditMuted: true, appliedAt: start },
      start + 19 * day,
    )).toBeNull();
  });

  test('permanent Mae communication restriction keeps renewing Reddit chunks', () => {
    expect(redditMuteAction(
      { muteUntil: null, permanent: true },
      { redditMuted: true, appliedAt: start },
      start + 27 * day,
    )).toBe('mute');
  });

  test('persisted reputation state drives the actual runtime mute effect', () => {
    const raw = {
      users: {
        alice: { username: 'Alice' },
      },
      discipline: {
        alice: {
          muteUntil: start + 30 * day,
          mutePermanent: false,
          redditMuted: false,
          muteAppliedAt: null,
        },
      },
    };

    expect(reputationMuteEffects(raw, start)).toEqual([{
      username: 'Alice',
      action: 'mute',
      note: 'Mae uncivil reputation state',
    }]);
  });

  test('persisted runtime state does not produce the old two-day refresh spam', () => {
    const raw = {
      users: {
        alice: { username: 'Alice' },
      },
      discipline: {
        alice: {
          muteUntil: start + 30 * day,
          mutePermanent: false,
          redditMuted: true,
          muteAppliedAt: start,
        },
      },
    };

    expect(reputationMuteEffects(raw, start + 2 * day)).toEqual([]);
    expect(reputationMuteEffects(raw, start + 27 * day)).toEqual([{
      username: 'Alice',
      action: 'mute',
      note: 'Mae uncivil reputation state',
    }]);
  });

  test('persisted runtime state explicitly unmutes when Mae debt expires', () => {
    const raw = {
      users: {
        alice: { username: 'Alice' },
      },
      discipline: {
        alice: {
          muteUntil: start + 30 * day,
          mutePermanent: false,
          redditMuted: true,
          muteAppliedAt: start + 27 * day,
        },
      },
    };

    expect(reputationMuteEffects(raw, start + 30 * day)).toEqual([{
      username: 'Alice',
      action: 'unmute',
      note: 'Mae reputation mute ended',
    }]);
  });
});