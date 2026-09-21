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

test('Modmail archive stays behind the canonical Reddit mutation client', async () => {
  const source = await readFile('src/reddit/mutate.ts', 'utf8');
  expect(source).toContain('public async archiveModmail(conversationId: string): Promise<void>');
  expect(source).toContain("{ kind: 'get', name: 'modMail' }");
  expect(source).toContain("{ kind: 'call', name: 'archiveConversation'");
  expect(source).not.toContain('oauth.reddit.com');
});
