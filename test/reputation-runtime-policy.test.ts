import { describe, expect, test } from 'bun:test';
import type { ModerationClassification } from '../src/mod/classifier.ts';
import { REPUTATION_FLOOR } from '../src/reputation/policy.ts';
import { applyModerationClassification } from '../src/reputation/runtimePolicy.ts';

const classification = (
  verdict: ModerationClassification['verdict'],
): ModerationClassification => ({
  verdict,
  rule: verdict === 'clean' ? 'none' : verdict === 'scam' ? 'rule_5' : 'rule_6',
  disposition: verdict === 'clean' || verdict === 'low' ? 'allow' : 'remove',
  confidence: 1,
  reason: verdict,
  evidence: [],
});

describe('runtime reputation policy', () => {
  test('clean contributions add exactly one point and cross tier boundaries', () => {
    expect(applyModerationClassification({ points: 0, status: 'ordinary' }, classification('clean')))
      .toMatchObject({ points: 1, tier: 1, status: 'ordinary', remove: false, ban: false });
    expect(applyModerationClassification({ points: 9, status: 'ordinary' }, classification('clean')))
      .toMatchObject({ points: 10, tier: 2 });
    expect(applyModerationClassification({ points: 99, status: 'ordinary' }, classification('clean')))
      .toMatchObject({ points: 100, tier: 3 });
    expect(applyModerationClassification({ points: 999, status: 'ordinary' }, classification('clean')))
      .toMatchObject({ points: 1000, tier: 4 });
    expect(applyModerationClassification({ points: 9998, status: 'ordinary' }, classification('clean')))
      .toMatchObject({ points: 9999, tier: 5 });
    expect(applyModerationClassification({ points: 9999, status: 'ordinary' }, classification('clean')))
      .toMatchObject({ points: 9999, tier: 5 });
  });

  test('low violations deduct one point without removing content and can deepen negative debt', () => {
    expect(applyModerationClassification({ points: 10, status: 'ordinary' }, classification('low')))
      .toMatchObject({ points: 9, tier: 1, status: 'ordinary', remove: false, ban: false });
    expect(applyModerationClassification({ points: 1, status: 'ordinary' }, classification('low')))
      .toMatchObject({ points: 0, tier: 0, status: 'warned', remove: false, ban: false });
    expect(applyModerationClassification({ points: 0, status: 'warned' }, classification('low')))
      .toMatchObject({ points: -1, tier: 0, status: 'warned', remove: false, ban: false });
    expect(applyModerationClassification({ points: -1, status: 'warned' }, classification('low')))
      .toMatchObject({ points: -2, tier: 0, status: 'uncivil', remove: false, ban: false });
    expect(applyModerationClassification({ points: -8, status: 'uncivil' }, classification('low')))
      .toMatchObject({ points: -9, tier: 0, status: 'uncivil', remove: false, ban: false });
    expect(applyModerationClassification({ points: -9, status: 'uncivil' }, classification('low')))
      .toEqual({ points: REPUTATION_FLOOR, tier: 0, status: 'banned', remove: true, ban: true });
  });

  test('severe violations wipe positive standing then descend through warned and uncivil to ban on minus ten', () => {
    expect(applyModerationClassification({ points: 423, status: 'ordinary' }, classification('severe')))
      .toMatchObject({ points: -1, tier: 0, status: 'warned', remove: true, ban: false });
    expect(applyModerationClassification({ points: -1, status: 'warned' }, classification('severe')))
      .toMatchObject({ points: -2, tier: 0, status: 'uncivil', remove: true, ban: false });
    expect(applyModerationClassification({ points: -8, status: 'uncivil' }, classification('severe')))
      .toMatchObject({ points: -9, tier: 0, status: 'uncivil', remove: true, ban: false });
    expect(applyModerationClassification({ points: -9, status: 'uncivil' }, classification('severe')))
      .toEqual({ points: REPUTATION_FLOOR, tier: 0, status: 'banned', remove: true, ban: true });
  });

  test('warned and uncivil users redeem through clean audited contributions and remain marked through zero', () => {
    expect(applyModerationClassification({ points: -9, status: 'uncivil' }, classification('clean')))
      .toMatchObject({ points: -8, tier: 0, status: 'uncivil', remove: false, ban: false });
    expect(applyModerationClassification({ points: -2, status: 'uncivil' }, classification('clean')))
      .toMatchObject({ points: -1, tier: 0, status: 'warned', remove: false, ban: false });
    expect(applyModerationClassification({ points: -1, status: 'warned' }, classification('clean')))
      .toMatchObject({ points: 0, tier: 0, status: 'warned', remove: false, ban: false });
    expect(applyModerationClassification({ points: 0, status: 'warned' }, classification('clean')))
      .toMatchObject({ points: 1, tier: 1, status: 'ordinary', remove: false, ban: false });
  });

  test('scam promotion immediately reaches the permanent floor and bans', () => {
    expect(applyModerationClassification({ points: 9999, status: 'ordinary' }, classification('scam')))
      .toEqual({
        points: REPUTATION_FLOOR,
        tier: 0,
        status: 'scam',
        remove: true,
        ban: true,
      });
  });

  test('permanent bans cannot be redeemed', () => {
    expect(applyModerationClassification({ points: REPUTATION_FLOOR, status: 'banned' }, classification('clean')))
      .toMatchObject({ points: REPUTATION_FLOOR, status: 'banned', ban: true });
    expect(applyModerationClassification({ points: REPUTATION_FLOOR, status: 'scam' }, classification('clean')))
      .toMatchObject({ points: REPUTATION_FLOOR, status: 'scam', ban: true });
  });
});
