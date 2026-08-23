import { describe, expect, test } from 'bun:test';
import { suspiciousVoteGrowth } from '../src/reputation/voteWatch.ts';

describe('suspicious Reddit vote growth', () => {
  test('ordinary gradual voting is not flagged', () => {
    expect(suspiciousVoteGrowth(
      { score: 2, at: 1_000 },
      { score: 8, at: 1_000 + 20 * 60 },
    )).toBeNull();
  });

  test('a rapid ten-vote burst is surfaced for moderator review', () => {
    const suspicion = suspiciousVoteGrowth(
      { score: 2, at: 1_000 },
      { score: 12, at: 1_000 + 2 * 60 },
    );
    expect(suspicion).not.toBeNull();
    expect(suspicion).toMatchObject({ delta: 10, elapsedSeconds: 120 });
  });

  test('a larger half-hour burst is surfaced even at a slower instantaneous rate', () => {
    expect(suspiciousVoteGrowth(
      { score: 10, at: 1_000 },
      { score: 35, at: 1_000 + 25 * 60 },
    )).not.toBeNull();
  });

  test('score drops and same-time fuzz observations are ignored', () => {
    expect(suspiciousVoteGrowth({ score: 10, at: 1_000 }, { score: 7, at: 1_060 })).toBeNull();
    expect(suspiciousVoteGrowth({ score: 10, at: 1_000 }, { score: 50, at: 1_000 })).toBeNull();
  });
});
