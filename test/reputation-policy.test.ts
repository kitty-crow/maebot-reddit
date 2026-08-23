import { describe, expect, test } from 'bun:test';
import type { RedditFlairAssignment } from '../src/reddit/types.ts';
import {
  chooseTierOneFlair,
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
  test('uses the agreed point boundaries including tier four only above 999', () => {
    expect(tierForPoints(0)).toBe(0);
    expect(tierForPoints(1)).toBe(1);
    expect(tierForPoints(9)).toBe(1);
    expect(tierForPoints(10)).toBe(2);
    expect(tierForPoints(99)).toBe(2);
    expect(tierForPoints(100)).toBe(3);
    expect(tierForPoints(999)).toBe(3);
    expect(tierForPoints(1000)).toBe(4);
  });

  test('seeds existing ordinary flair holders at the floor of their current tier', () => {
    expect(tierFlair(assignment(':mae:'))?.seedPoints).toBe(1);
    expect(tierFlair(assignment(':lisa:'))?.seedPoints).toBe(1);
    expect(tierFlair(assignment(':kita:'))?.seedPoints).toBe(10);
    expect(tierFlair(assignment(':aoi:'))?.seedPoints).toBe(10);
    expect(tierFlair(assignment(':hana:'))?.seedPoints).toBe(100);
    expect(tierFlair(assignment(':rin:'))?.seedPoints).toBe(100);
    expect(tierFlair(assignment(':celeste:'))?.seedPoints).toBe(1000);
  });

  test('maps legacy moderation flair semantics onto the negative score states', () => {
    expect(moderationStatus(assignment('Warned', 'w'), false)).toEqual({ status: 'warned', points: -1 });
    expect(moderationStatus(assignment('Uncivil', 'u'), false)).toEqual({ status: 'uncivil', points: -2 });
    expect(moderationStatus(assignment('SCAM', 's'), true)).toEqual({ status: 'scam', points: -4 });
    expect(moderationStatus(assignment(':mae:'), true)).toEqual({ status: 'banned', points: -3 });
  });

  test('uses the one-time tier-one variant probabilities without reroll policy in the store', () => {
    expect(chooseTierOneFlair(() => 0)).toBe(':lisa:');
    expect(chooseTierOneFlair(() => 0.009999)).toBe(':lisa:');
    expect(chooseTierOneFlair(() => 0.01)).toBe(':mae:');
    expect(chooseTierOneFlair(() => 0.5)).toBe(':mae:');
  });
});
