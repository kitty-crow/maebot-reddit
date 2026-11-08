import { describe, expect, test } from 'bun:test';
import { checkSource } from '../scripts/sourceGuard.ts';

describe('migration source guard', () => {
  test('accepts sibling guards and typed source', () => {
    const code = 'if (one) return;\nif (two) return;\nconst value: string = "ok";';
    expect(checkSource('src/example.ts', code)).toEqual([]);
  });

  test('rejects conditional nesting even across intervening blocks', () => {
    const code = 'if (one) { try { if (two) return; } finally {} }';
    expect(checkSource('devvit/src/example.ts', code).map(item => item.reason)).toContain('nested if');
  });

  test('rejects explicit loose types', () => {
    const code = 'let first: any;\nlet second: unknown;';
    expect(checkSource('devvit/src/example.ts', code).map(item => item.reason)).toEqual([
      'explicit any',
      'explicit unknown',
    ]);
  });

  test('rejects JavaScript but not declaration files or external artefacts', () => {
    expect(checkSource('devvit/src/x.js', 'const x = true;')[0]?.reason).toBe('JavaScript source');
    expect(checkSource('devvit/src/x.d.ts', 'type X = any;')).toEqual([]);
    expect(checkSource('devvit/dist/x.cjs.map', '')).toEqual([]);
  });

  test('does not count conditionals inside a separate function as nested', () => {
    const code = 'if (one) { function local() { if (two) return; } }';
    expect(checkSource('src/example.ts', code)).toEqual([]);
  });
});
