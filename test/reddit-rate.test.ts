import { describe, expect, test } from 'bun:test';
import { backoffMs, rateFrom } from '../src/reddit/rate.ts';

describe('legacy rate helpers retained for compatibility tooling', () => {
  test('parses standard Reddit rate headers', () => {
    expect(rateFrom(new Headers({
      'x-ratelimit-used': '1',
      'x-ratelimit-remaining': '99',
      'x-ratelimit-reset': '600',
    }))).toEqual({ used: 1, remaining: 99, resetMs: 600_000 });
  });

  test('bounded backoff can be deterministic', () => {
    expect(backoffMs(0, () => 0)).toBe(375);
    expect(backoffMs(20, () => 1)).toBe(37_500);
  });
});
