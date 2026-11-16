import { redditConfig } from '../src/env.ts';
import { planStaleMaeCrossposts, mirrorCutoffUtc } from '../src/mirror/cleanup.ts';
import { RedditReadClient } from '../src/reddit/client.ts';
import { RedditMutationClient } from '../src/reddit/mutate.ts';
import type { RedditPost } from '../src/reddit/types.ts';

const usage = 'Usage: bun run scripts/cleanupHistoricalCrossposts.ts [--execute]';
const argumentsPassed = process.argv.slice(2);
if (argumentsPassed.some(arg => arg !== '--execute') || argumentsPassed.filter(arg => arg === '--execute').length > 1) {
  throw new Error(usage);
}
const execute = argumentsPassed.includes('--execute');
const cfg = redditConfig();
const account = 'this_is_the_mae';
const target = 'nyaonearth';
if (cfg.auth.username.toLowerCase() !== account) {
  throw new Error('Cleanup requires the this_is_the_mae account');
}
const read = new RedditReadClient(cfg.auth);
const loggedIn = await read.me();
if (loggedIn.name.toLowerCase() !== account) {
  throw new Error(`Refusing cleanup: authenticated as u/${loggedIn.name}, not u/${account}`);
}

console.log(`Mae cross-post cleanup for r/${target}`);
console.log(`Original creation cut-off: ${new Date(mirrorCutoffUtc * 1_000).toISOString()}`);
console.log(execute ? 'MODE: DELETE Mae-owned matches' : 'MODE: PREVIEW ONLY (no deletion)');

const [authored, subredditPosts] = await Promise.all([
  read.submittedPosts(account, 1000),
  read.newPostsHistory(target, 1000),
]);
const collected = new Map<string, RedditPost>();
for (const post of [...authored, ...subredditPosts]) collected.set(post.fullname, post);

if (authored.length === 1000 || subredditPosts.length === 1000) {
  console.warn('Reddit listing limit reached (1,000). Older submissions outside accessible listings cannot be checked.');
}

const plan = await planStaleMaeCrossposts([...collected.values()], read, account, target);
console.log(`Mae mirror submissions inspected: ${plan.scanned}`);
console.log(`Pre-cutoff originals found: ${plan.candidates.length}`);
console.log(`Unverifiable original chains (will not delete): ${plan.unresolved.length}`);

for (const item of plan.candidates) {
  console.log(`MATCH ${item.post.fullname} original=${item.original.fullname} originally=${new Date(item.original.createdUtc * 1_000).toISOString()} url=https://www.reddit.com${item.post.permalink}`);
}
for (const item of plan.unresolved) {
  console.warn(`SKIP  ${item.post.fullname} unverified_source=${item.sourceFullname}`);
}

if (!execute) {
  console.log('No changes made. Run again with --execute to delete the listed copies.');
} else {
  const writer = new RedditMutationClient(cfg.auth);
  let deleted = 0;
  let skipped = 0;
  let failed = 0;
  for (const item of plan.candidates) {
    try {
      // Recheck the live target and its full source ancestry immediately before deletion.
      const live = (await read.postsByFullnames([item.post.fullname]))[0];
      if (live === undefined || live.fullname !== item.post.fullname) {
        skipped += 1;
        console.warn(`SKIP ${item.post.fullname}: original target is no longer available`);
        continue;
      }
      const verified = await planStaleMaeCrossposts([live], read, account, target);
      if (verified.candidates.length !== 1 || verified.unresolved.length > 0) {
        skipped += 1;
        console.warn(`SKIP ${item.post.fullname}: source, author or date could not be reverified`);
        continue;
      }
      await writer.deleteOwnPost(item.post.fullname);
      deleted += 1;
      console.log(`DELETED ${item.post.fullname}`);
    } catch (error) {
      failed += 1;
      console.error(`FAILED ${item.post.fullname}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`Complete: deleted=${deleted} skipped=${skipped} failed=${failed} unresolved=${plan.unresolved.length}`);
  if (failed > 0 || plan.unresolved.length > 0) process.exitCode = 1;
}
