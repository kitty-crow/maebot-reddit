import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('startup community projection failure cannot kill Mae Reddit', async () => {
  const source = await readFile(
    resolve(process.cwd(), 'src/main.ts'),
    'utf8',
  );

  const start = source.indexOf('if (communityProjection !== null) {', source.indexOf('const stopMemberModNotes'));
  const end = source.indexOf('if (postMirror !== null)', start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  const startup = source.slice(start, end);

  expect(startup).toMatch(
    /try\s*\{[\s\S]*?const primed = await communityProjection\.tick\(\);[\s\S]*?\}\s*catch \(error\)\s*\{[\s\S]*?startup projection failed/,
  );
});
