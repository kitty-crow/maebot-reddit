import { describe, expect, test } from 'bun:test';
import { reputationMuteEffects } from '../src/reputation/muteReconcile.ts';
import {
  UNCIVIL_MUTE_MS,
  redditMuteAction,
} from '../src/reputation/mutePolicy.ts';

const day = 24 * 60 * 60 * 1_000;
const start = 1_000_000;

describe('Reddit modmail mute reconciliation', () => {
  test('a new seven-day Mae mute immediately applies one Reddit mute', () => {
    expect(redditMuteAction(
      { muteUntil: start + UNCIVIL_MUTE_MS, permanent: false },
      { redditMuted: false, appliedAt: null },
      start,
    )).toBe('mute');
  });

  test('a seven-day Mae mute is not renewed', () => {
    const desired = { muteUntil: start + UNCIVIL_MUTE_MS, permanent: false };
    const applied = { redditMuted: true, appliedAt: start };
    expect(redditMuteAction(desired, applied, start + 6 * day)).toBeNull();
  });

  test('Mae clears her application checkpoint when the canonical mute debt ends', () => {
    expect(redditMuteAction(
      { muteUntil: start + UNCIVIL_MUTE_MS, permanent: false },
      { redditMuted: true, appliedAt: start },
      start + UNCIVIL_MUTE_MS,
    )).toBe('unmute');
  });

  test('cumulative uncivil debt does not turn into repeated Reddit mute notifications', () => {
    expect(redditMuteAction(
      { muteUntil: start + 14 * day, permanent: false },
      { redditMuted: true, appliedAt: start },
      start + 10 * day,
    )).toBeNull();
  });

  test('permanent Mae communication restriction gets only one Reddit mute application', () => {
    const desired = { muteUntil: null, permanent: true };
    const applied = { redditMuted: true, appliedAt: start };
    expect(redditMuteAction(desired, applied, start + 29 * day)).toBeNull();
    expect(redditMuteAction(desired, applied, start + 365 * day)).toBeNull();
  });

  test('legacy applied state without a timestamp is not re-muted', () => {
    expect(redditMuteAction(
      { muteUntil: null, permanent: true },
      { redditMuted: true, appliedAt: null },
      start + 365 * day,
    )).toBeNull();
  });

  test('persisted reputation state drives the initial runtime mute effect', () => {
    const raw = {
      users: {
        alice: { username: 'Alice' },
      },
      discipline: {
        alice: {
          muteUntil: start + UNCIVIL_MUTE_MS,
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

  test('bootstrap-seeded banned and scam users receive one initial mute', () => {
    const raw = {
      users: {
        banned: { username: 'BannedUser', status: 'banned' },
        scam: { username: 'ScamUser', status: 'scam' },
      },
      discipline: {},
    };

    expect(reputationMuteEffects(raw, start)).toEqual([
      { username: 'BannedUser', action: 'mute', note: 'Mae permanent reputation enforcement' },
      { username: 'ScamUser', action: 'mute', note: 'Mae permanent reputation enforcement' },
    ]);
  });

  test('bootstrap-seeded uncivil user receives one normal seven-day restriction', () => {
    const initial = {
      users: {
        alice: { username: 'Alice', status: 'uncivil' },
      },
      discipline: {},
    };
    expect(reputationMuteEffects(initial, start)).toEqual([{
      username: 'Alice', action: 'mute', note: 'Mae uncivil reputation state',
    }]);

    const applied = {
      users: initial.users,
      discipline: {
        alice: {
          muteUntil: null,
          mutePermanent: false,
          redditMuted: true,
          muteAppliedAt: start,
        },
      },
    };
    expect(reputationMuteEffects(applied, start + 6 * day)).toEqual([]);
    expect(reputationMuteEffects(applied, start + UNCIVIL_MUTE_MS)).toEqual([{
      username: 'Alice', action: 'unmute', note: 'Mae reputation mute ended',
    }]);
  });

  test('persisted permanent runtime state never produces monthly renewal spam', () => {
    const raw = {
      users: {
        alice: { username: 'Alice', status: 'banned' },
      },
      discipline: {
        alice: {
          muteUntil: null,
          mutePermanent: true,
          redditMuted: true,
          muteAppliedAt: start,
        },
      },
    };

    expect(reputationMuteEffects(raw, start + 30 * day)).toEqual([]);
    expect(reputationMuteEffects(raw, start + 60 * day)).toEqual([]);
    expect(reputationMuteEffects(raw, start + 365 * day)).toEqual([]);
  });
});
