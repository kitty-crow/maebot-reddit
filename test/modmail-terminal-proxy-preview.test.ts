import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('Reddit no longer owns or starts the Modmail browser terminal', async () => {
  const main = await readFile('src/main.ts', 'utf8');
  const env = await readFile('src/env.ts', 'utf8');
  const pkg = await readFile('package.json', 'utf8');

  expect(main).not.toContain('ModmailTerminalServer');
  expect(main).not.toContain('modmailTerminalConfig');
  expect(env).not.toContain('REDDIT_MODMAIL_WEBAPP_');
  expect(pkg).not.toContain('react-dom');
  expect(pkg).not.toContain('"react"');
});
