import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('focused Modmail preview remains read-only behind an arbitrary reverse-proxy prefix', async () => {
  const source = await readFile('src/modmail/terminalPage.ts', 'utf8');
  expect(source).toContain("const preview = base.endsWith('/preview');");
  expect(source).not.toContain("const preview = base === '/preview';");
  expect(source).toContain("status.textContent = 'Synthetic read-only preview. Nothing here can reach Reddit.';");
  expect(source).toContain('setEnabled(false);');
});
