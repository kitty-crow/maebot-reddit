import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('Reddit Modmail transport is not gated by the LLM moderation feature flag', async () => {
  const source = await readFile('src/main.ts', 'utf8');
  expect(source).toContain('const modmailReader = moderationReader ?? new RedditReadClient(redditCfg.auth);');
  expect(source).toContain('const modmailWriter = moderationWriter ?? new RedditMutationClient(redditCfg.auth);');
  expect(source).toContain('const modmail = new ModmailRuntime(');
  expect(source).toContain('internal?.useModmail(modmailStore, modmailOutbox, modmailMedia, reputation, modmailWriter);');
  expect(source).not.toContain('const modmail = moderationReader === null || moderationWriter === null');
});

test('Modmail archive uses the canonical Reddit mutation client', async () => {
  const source = await readFile('src/reddit/mutate.ts', 'utf8');
  expect(source).toContain('public async archiveModmail(conversationId: string): Promise<void>');
  expect(source).toContain('`/api/mod/conversations/${encodeURIComponent(id)}/archive`');
  expect(source).not.toContain('fetch(`https://oauth.reddit.com/api/mod/conversations');
});
