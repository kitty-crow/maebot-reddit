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

  test('low violations deduct one point without removing content', () => {
    expect(applyModerationClassification({ points: 10, status: 'ordinary' }, classification('low')))
      .toMatchObject({ points: 9, tier: 1, status: 'ordinary', remove: false, ban: false });
    expect(applyModerationClassification({ points: 0, status: 'ordinary' }, classification('low')))
      .toMatchObject({ points: -1, tier: 0, status: 'warned', remove: false, ban: false });
  });

  test('severe violations escalate warned to uncivil then permanent ban floor', () => {
    expect(applyModerationClassification({ points: 423, status: 'ordinary' }, classification('severe')))
      .toMatchObject({ points: -1, tier: 0, status: 'warned', remove: true, ban: false });
    expect(applyModerationClassification({ points: -1, status: 'warned' }, classification('severe')))
      .toMatchObject({ points: -2, tier: 0, status: 'uncivil', remove: true, ban: false });
    expect(applyModerationClassification({ points: -2, status: 'uncivil' }, classification('severe')))
      .toMatchObject({ points: REPUTATION_FLOOR, tier: 0, status: 'banned', remove: true, ban: true });
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

  test('clean activity and vote credit cannot rehabilitate negative states implicitly', () => {
    expect(applyModerationClassification({ points: -1, status: 'warned' }, classification('clean')))
      .toMatchObject({ points: -1, status: 'warned' });
    expect(applyModerationClassification({ points: -2, status: 'uncivil' }, classification('clean')))
      .toMatchObject({ points: -2, status: 'uncivil' });
    expect(applyModerationClassification({ points: REPUTATION_FLOOR, status: 'banned' }, classification('clean')))
      .toMatchObject({ points: REPUTATION_FLOOR, status: 'banned', ban: true });
  });
});
