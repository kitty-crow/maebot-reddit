import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('Mae Reddit DM responder keeps canonical persona and private policy boundaries', async () => {
  const source = await readFile('src/dm/reply.ts', 'utf8');

  expect(source).toContain('Mae persona:');
  expect(source).toContain('managed conversation contains Mae\'s earlier direct-message dialogue');
  expect(source).toContain('Never mention internal moderation classifications, reputation points');
  expect(source).toContain('respond=false for obvious automated junk, phishing/scam payloads');
  expect(source).toContain('Ordinary criticism and scepticism are allowed.');
  expect(source).toContain('{ conversation: true }');
  expect(source).toContain('if (text.length > 10_000)');
});

test('there is only one canonical Reddit DM responder implementation', async () => {
  const runtime = await readFile('src/dm/runtime.ts', 'utf8');
  expect(runtime).toContain("from './reply.ts'");
  expect(runtime).not.toContain("from './responder.ts'");
});
