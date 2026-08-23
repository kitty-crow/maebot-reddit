import { describe, expect, test } from 'bun:test';
import { constructiveResolutionTransition, disciplineTransition } from '../src/reputation/discipline.ts';
import { UNCIVIL_MUTE_MS } from '../src/reputation/mutePolicy.ts';

const now = 1_000_000;

describe('reputation discipline transitions', () => {
  test('jumping directly into uncivil creates one thirty-day mute', () => {
    const result = disciplineTransition({
      beforeStatus: 'ordinary',
      afterStatus: 'uncivil',
      violation: true,
      currentMute: { muteUntil: null, permanent: false },
      atMs: now,
    });
    expect(result).toEqual({
      mute: { muteUntil: now + UNCIVIL_MUTE_MS, permanent: false },
      muteChanged: true,
    });
  });

  test('one severe event only adds one mute period even if it crosses several reputation points', () => {
    const result = disciplineTransition({
      beforeStatus: 'warned',
      afterStatus: 'uncivil',
      violation: true,
      currentMute: { muteUntil: null, permanent: false },
      atMs: now,
    });
    expect(result.mute.muteUntil).toBe(now + UNCIVIL_MUTE_MS);
  });

  test('another offending event while uncivil adds another thirty days cumulatively', () => {
    const result = disciplineTransition({
      beforeStatus: 'uncivil',
      afterStatus: 'uncivil',
      violation: true,
      currentMute: { muteUntil: now + 4 * 24 * 60 * 60 * 1_000, permanent: false },
      atMs: now,
    });
    expect(result.mute.muteUntil).toBe(now + 34 * 24 * 60 * 60 * 1_000);
  });

  test('clean uncivil redemption does not extend the mute and crossing back to warned clears it', () => {
    const currentMute = { muteUntil: now + UNCIVIL_MUTE_MS, permanent: false };
    expect(disciplineTransition({
      beforeStatus: 'uncivil',
      afterStatus: 'uncivil',
      violation: false,
      currentMute,
      atMs: now,
    }).mute).toEqual(currentMute);

    expect(disciplineTransition({
      beforeStatus: 'uncivil',
      afterStatus: 'warned',
      violation: false,
      currentMute,
      atMs: now,
    }).mute).toEqual({ muteUntil: null, permanent: false });
  });

  test('permanent enforcement makes the modmail mute permanent', () => {
    expect(disciplineTransition({
      beforeStatus: 'uncivil',
      afterStatus: 'banned',
      violation: true,
      currentMute: { muteUntil: now + UNCIVIL_MUTE_MS, permanent: false },
      atMs: now,
    }).mute).toEqual({ muteUntil: null, permanent: true });
  });

  test('constructive resolution clears temporary mute without changing reputation status', () => {
    expect(constructiveResolutionTransition(
      'uncivil',
      { muteUntil: now + UNCIVIL_MUTE_MS, permanent: false },
    )).toEqual({ mute: { muteUntil: null, permanent: false }, muteChanged: true });
  });

  test('constructive resolution cannot clear a permanent ban mute', () => {
    expect(constructiveResolutionTransition(
      'banned',
      { muteUntil: null, permanent: true },
    )).toEqual({ mute: { muteUntil: null, permanent: true }, muteChanged: false });
  });
});
