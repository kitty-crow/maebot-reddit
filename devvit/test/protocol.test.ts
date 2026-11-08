import { describe, expect, test } from 'vitest';
import { healthResponse } from '../src/server/protocol.ts';

describe('Devvit managed endpoint protocol', () => {
  test('uses the canonical app identity and version', () => {
    expect(healthResponse('this_is_the_mae')).toEqual({
      ok: true,
      protocol: 1,
      app: 'this-is-the-mae',
      redditUser: 'this_is_the_mae',
    });
  });
});
