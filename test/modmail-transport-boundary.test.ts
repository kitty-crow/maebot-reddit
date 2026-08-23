import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('Reddit Modmail transport is not gated by the LLM moderation feature flag', async () => {
  const source = await readFile('src/main.ts', 'utf8');
  expect(source).toContain('const modmailReader = moderationReader ?? new RedditReadClient(redditCfg.auth);');
  expect(source).toContain('const modmailWriter = moderationWriter ?? new RedditMutationClient(redditCfg.auth);');
  expect(source).toContain('const modmail = new ModmailRuntime(');
  expect(source).not.toContain('const modmail = moderationReader === null || moderationWriter === null');
});
