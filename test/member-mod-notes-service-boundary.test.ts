import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('member Mod Notes service error boundary', () => {
  test('startup priming failure cannot escape and kill Mae Reddit', async () => {
    const source = await readFile(
      resolve(process.cwd(), 'src/modnotes/service.ts'),
      'utf8',
    );

    const start = source.indexOf('const interval = pollMs();');
    const end = source.indexOf('let ticking = false;');

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const startup = source.slice(start, end);

    expect(startup).toMatch(
      /try\s*\{[\s\S]*?const primed = await watcher\.tick\(\);[\s\S]*?\}\s*catch \(error\)\s*\{[\s\S]*?startup prime failed/,
    );
  });
});
