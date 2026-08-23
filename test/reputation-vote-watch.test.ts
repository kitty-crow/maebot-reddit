import { describe, expect, test } from 'bun:test';
import {
  configuredVoteWatchPolicy,
  suspiciousVoteGrowth,
  type VoteWatchPolicy,
} from '../src/reputation/voteWatch.ts';

const quietCommunity: VoteWatchPolicy = {
  rules: [{ name: 'quiet-community burst', maxSeconds: 10 * 60, minDelta: 6, minRatePerMinute: 0.5 }],
};

const busyCommunity: VoteWatchPolicy = {
  rules: [{ name: 'busy-community burst', maxSeconds: 10 * 60, minDelta: 30, minRatePerMinute: 3 }],
};

describe('suspicious Reddit vote growth', () => {
  test('ordinary gradual voting is not flagged by the bootstrap policy', () => {
    expect(suspiciousVoteGrowth(
      { score: 2, at: 1_000 },
      { score: 8, at: 1_000 + 20 * 60 },
    )).toBeNull();
  });

  test('the same trajectory can be suspicious in a quiet community and ordinary in a busy one', () => {
    const previous = { score: 2, at: 1_000 };
    const current = { score: 12, at: 1_000 + 2 * 60 };
    expect(suspiciousVoteGrowth(previous, current, quietCommunity)).not.toBeNull();
    expect(suspiciousVoteGrowth(previous, current, busyCommunity)).toBeNull();
  });

  test('evidence names the configured community rule rather than presenting it as proof', () => {
    const suspicion = suspiciousVoteGrowth(
      { score: 10, at: 1_000 },
      { score: 20, at: 1_000 + 5 * 60 },
      quietCommunity,
    );
    expect(suspicion).not.toBeNull();
    expect(suspicion?.evidence.join('\n')).toContain('quiet-community burst');
    expect(suspicion?.evidence.join('\n')).toContain('not proof');
  });

  test('environment calibration replaces the fallback N/T values without code changes', () => {
    const policy = configuredVoteWatchPolicy({
      REDDIT_VOTE_WATCH_FAST_SECONDS: '600',
      REDDIT_VOTE_WATCH_FAST_DELTA: '7',
      REDDIT_VOTE_WATCH_FAST_RATE: '0.75',
      REDDIT_VOTE_WATCH_MEDIUM_SECONDS: '1800',
      REDDIT_VOTE_WATCH_MEDIUM_DELTA: '20',
      REDDIT_VOTE_WATCH_MEDIUM_RATE: '0.5',
      REDDIT_VOTE_WATCH_LARGE_SECONDS: '3600',
      REDDIT_VOTE_WATCH_LARGE_DELTA: '40',
      REDDIT_VOTE_WATCH_LARGE_RATE: '0',
    });
    expect(policy.rules[0]).toEqual({
      name: 'fast community burst',
      maxSeconds: 600,
      minDelta: 7,
      minRatePerMinute: 0.75,
    });
    expect(suspiciousVoteGrowth(
      { score: 1, at: 100 },
      { score: 8, at: 100 + 5 * 60 },
      policy,
    )).not.toBeNull();
  });

  test('score drops and same-time fuzz observations are ignored', () => {
    expect(suspiciousVoteGrowth({ score: 10, at: 1_000 }, { score: 7, at: 1_060 })).toBeNull();
    expect(suspiciousVoteGrowth({ score: 10, at: 1_000 }, { score: 50, at: 1_000 })).toBeNull();
  });
});
