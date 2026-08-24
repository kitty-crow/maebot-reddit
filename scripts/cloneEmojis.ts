import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cloneCommunityEmojis } from '../src/emoji/migrate.ts';
import { redditConfig } from '../src/env.ts';
import { RedditReadClient } from '../src/reddit/client.ts';
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

  const read = new RedditReadClient(cfg.auth, { rateReserve: maintenanceRateReserve });
  const write = new RedditMutationClient(cfg.auth, { rateReserve: maintenanceRateReserve });
  const result = await cloneCommunityEmojis(
    read,
    write,
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
