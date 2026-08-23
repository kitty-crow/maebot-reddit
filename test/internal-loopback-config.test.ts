import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('Reddit internal APIs stay loopback-only and focused Modmail defaults to 127.0.0.1:8892', async () => {
  const source = await readFile('src/env.ts', 'utf8');

  expect(source).toContain("const loopbackHost = (name: string, fallback = '127.0.0.1')");
  expect(source).toContain("throw new Error(`${name} must be a loopback host`)");
  expect(source).toContain("host: loopbackHost('REDDIT_INTERNAL_API_HOST')");
  expect(source).toContain("host: loopbackHost('REDDIT_MODMAIL_WEBAPP_HOST')");
  expect(source).toContain("maybe('REDDIT_MODMAIL_WEBAPP_PORT') ?? '8892'");
});
