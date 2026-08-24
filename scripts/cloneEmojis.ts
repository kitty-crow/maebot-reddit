import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promptSecret, promptText } from '../src/cli/securePrompt.ts';
import { cloneCommunityEmojis } from '../src/emoji/migrate.ts';
import { emojiClonePreflight } from '../src/emoji/preflight.ts';
import { redditConfig } from '../src/env.ts';
import { RedditReadClient } from '../src/reddit/client.ts';
import { redditEmojiAdminAuth } from '../src/reddit/emojiAdminAuth.ts';
import { safeError } from '../src/reddit/error.ts';
import { RedditMutationClient } from '../src/reddit/mutate.ts';
import { parseMap } from '../src/types/json.ts';

const sourceSubreddit = 'catgirlcoin';
const targetSubreddit = 'nyaonearth';
const exclusiveMigration = /^(?:1|true|yes|on)$/iu.test(process.env['REDDIT_MIGRATION_EXCLUSIVE']?.trim() ?? '');
const maintenanceRateReserve = exclusiveMigration ? 5 : 30;
if (exclusiveMigration) process.env['REDDIT_RATE_MINIMUM_INTERVAL_MS'] = '650';

const cfg = redditConfig();
if (cfg.sourceSubreddit.toLowerCase() !== sourceSubreddit) {
  throw new Error('Emoji clone requires REDDIT_SOURCE_SUBREDDIT=catgirlcoin');
}

const catalogueFile = resolve(
  process.cwd(),
  process.env['REDDIT_FLAIR_CATALOGUE_FILE']?.trim() || 'data/flairs.json',
);

const requireCompletedBootstrap = async (): Promise<void> => {
  const catalogue = parseMap(await readFile(catalogueFile, 'utf8'));
  if (catalogue['schema'] !== 2) throw new Error('Emoji clone requires a completed schema-2 community bootstrap');
  const source = catalogue['sourceSubreddit'];
  const target = catalogue['targetSubreddit'];
  if (source !== sourceSubreddit || target !== targetSubreddit) {
    throw new Error(
      `Emoji clone catalogue is ${String(source)} -> ${String(target)}, expected ${sourceSubreddit} -> ${targetSubreddit}`,
    );
  }
};

try {
  await requireCompletedBootstrap();

  console.log(
    exclusiveMigration
      ? 'Reddit migration pacing: EXCLUSIVE 650ms, reserve=5; Mae runtime must be offline.'
      : 'Reddit migration pacing: shared 1000ms, reserve=30.',
  );
  console.log('Custom emoji migration uses one interactive Reddit moderator account for both communities.');
  console.log('Credentials are held only in memory for this process and are never persisted.');

  const username = await promptText('Reddit admin username: ');
  const password = await promptSecret('Reddit admin password (hidden): ');
  const adminAuth = redditEmojiAdminAuth(cfg.auth, { username, password });

  const adminRead = new RedditReadClient(adminAuth, { rateReserve: maintenanceRateReserve });
  const adminWrite = new RedditMutationClient(adminAuth, { rateReserve: maintenanceRateReserve });
  const preflight = await emojiClonePreflight(adminRead, [
    { subreddit: sourceSubreddit, requireManageSettings: false },
    { subreddit: targetSubreddit, requireManageSettings: true },
  ]);
  if (!preflight.passed) {
    const failures = preflight.communities
      .filter(community => !community.passed)
      .flatMap(community => community.failures.map(failure => `r/${community.subreddit}: ${failure}`));
    throw new Error(`Emoji clone permission pre-flight failed: ${failures.join('; ')}`);
  }
  console.log(`Emoji clone operator verified: u/${preflight.accountName}`);

  const result = await cloneCommunityEmojis(
    { sourceRead: adminRead, targetRead: adminRead, targetWrite: adminWrite },
    sourceSubreddit,
    targetSubreddit,
    { log: message => console.log(message) },
  );

  await requireCompletedBootstrap();

  console.log(`Target custom emojis after clone: ${result.targetAfterCount}`);
  console.log(`Emoji assets uploaded/replaced: ${result.uploaded}`);
  console.log(`Emoji permission-only updates: ${result.permissionsUpdated}`);
  console.log(`Emoji entries already identical: ${result.unchanged}`);
  console.log(`Target-only emojis preserved: ${result.targetOnlyPreserved}`);
  console.log('CatgirlCoin -> NyaOnEarth custom emoji clone complete.');
} catch (error) {
  console.error(`Custom emoji clone failed: ${safeError(error)}`);
  process.exitCode = 1;
}
