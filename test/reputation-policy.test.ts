import { describe, expect, test } from 'bun:test';
import type { RedditFlairAssignment } from '../src/reddit/types.ts';
import {
  MODERATOR_POINTS,
  PAWSOME_POINTS,
  REPUTATION_CEILING,
  REPUTATION_FLOOR,
  chooseFlairForTier,
  chooseTierOneFlair,
  clampReputationPoints,
  moderationStatus,
  tierFlair,
  tierForPoints,
} from '../src/reputation/policy.ts';

const assignment = (text: string | null, cssClass: string | null = null): RedditFlairAssignment => ({
  username: 'member',
  templateId: 'template',
  text,
  cssClass,
});

describe('Reddit reputation tier policy', () => {
  test('uses the agreed ordinary point boundaries with Pawsome Contributor as tier five', () => {
    expect(tierForPoints(0)).toBe(0);
    expect(tierForPoints(1)).toBe(1);
    expect(tierForPoints(9)).toBe(1);
    expect(tierForPoints(10)).toBe(2);
    expect(tierForPoints(99)).toBe(2);
    expect(tierForPoints(100)).toBe(3);
    expect(tierForPoints(999)).toBe(3);
    expect(tierForPoints(1000)).toBe(4);
    expect(tierForPoints(PAWSOME_POINTS - 1)).toBe(4);
    expect(tierForPoints(PAWSOME_POINTS)).toBe(5);
    expect(tierForPoints(REPUTATION_CEILING)).toBe(5);
  });

  test('seeds existing ordinary flair holders from their current tier including Pawsome Contributor', () => {
    expect(tierFlair(assignment(':mae:'))?.seedPoints).toBe(1);
    expect(tierFlair(assignment(':lisa:'))?.seedPoints).toBe(1);
    expect(tierFlair(assignment(':kita:'))?.seedPoints).toBe(10);
    expect(tierFlair(assignment(':aoi:'))?.seedPoints).toBe(10);
    expect(tierFlair(assignment(':hana:'))?.seedPoints).toBe(100);
    expect(tierFlair(assignment(':rin:'))?.seedPoints).toBe(100);
    expect(tierFlair(assignment(':celeste:'))?.seedPoints).toBe(1000);
    expect(tierFlair(assignment('Pawsome Contributor'))?.seedPoints).toBe(PAWSOME_POINTS);
  });

  test('uses the permanent-ban floor and hard reputation ceiling', () => {
    expect(REPUTATION_FLOOR).toBe(-999_999_999);
    expect(REPUTATION_CEILING).toBe(999_999_999);
    expect(MODERATOR_POINTS).toBe(REPUTATION_CEILING);
    expect(clampReputationPoints(REPUTATION_FLOOR - 50)).toBe(REPUTATION_FLOOR);
    expect(clampReputationPoints(REPUTATION_CEILING + 50)).toBe(REPUTATION_CEILING);
    expect(clampReputationPoints(123)).toBe(123);
  });

  test('maps moderation flair semantics onto warned, uncivil and permanent-ban states', () => {
    expect(moderationStatus(assignment('Warned', 'w'), false)).toEqual({ status: 'warned', points: -1 });
    expect(moderationStatus(assignment('Uncivil', 'u'), false)).toEqual({ status: 'uncivil', points: -2 });
    expect(moderationStatus(assignment('SCAM', 's'), true)).toEqual({ status: 'scam', points: REPUTATION_FLOOR });
    expect(moderationStatus(assignment(':mae:'), true)).toEqual({ status: 'banned', points: REPUTATION_FLOOR });
  });

  test('uses the one-time tier flair probabilities at their exact boundaries', () => {
    expect(chooseFlairForTier(1, () => 0)).toBe(':lisa:');
    expect(chooseFlairForTier(1, () => 0.009999)).toBe(':lisa:');
    expect(chooseFlairForTier(1, () => 0.01)).toBe(':mae:');

    expect(chooseFlairForTier(2, () => 0)).toBe(':aoi:');
    expect(chooseFlairForTier(2, () => 0.000999)).toBe(':aoi:');
    expect(chooseFlairForTier(2, () => 0.001)).toBe(':kita:');

    expect(chooseFlairForTier(3, () => 0)).toBe(':rin:');
    expect(chooseFlairForTier(3, () => 0.000099)).toBe(':rin:');
    expect(chooseFlairForTier(3, () => 0.0001)).toBe(':hana:');

    expect(chooseFlairForTier(4, () => 0)).toBe(':celeste:');
    expect(chooseFlairForTier(4, () => 0.999999)).toBe(':celeste:');
    expect(chooseFlairForTier(5, () => Number.NaN)).toBe('Pawsome Contributor');
    expect(chooseTierOneFlair(() => 0)).toBe(':lisa:');
    expect(chooseTierOneFlair(() => 0.5)).toBe(':mae:');
  });

  test('rejects an invalid random source rather than silently skewing probabilistic flair odds', () => {
    expect(() => chooseFlairForTier(1, () => -0.1)).toThrow('[0, 1)');
    expect(() => chooseFlairForTier(2, () => 1)).toThrow('[0, 1)');
    expect(() => chooseFlairForTier(3, () => Number.NaN)).toThrow('[0, 1)');
  });
});
