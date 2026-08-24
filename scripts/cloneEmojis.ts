import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { downloadEmojiAsset, emojiCloneAction, unresolvedEmojiClone } from '../src/emoji/clone.ts';
import { redditConfig } from '../src/env.ts';
import { RedditReadClient } from '../src/reddit/client.ts';
import type { RedditEmoji } from '../src/reddit/emoji.ts';
import { safeError } from '../src/reddit/error.ts';
import { RedditMutationClient } from '../src/reddit/mutate.ts';
import { parseMap } from '../src/types/json.ts';

const sourceSubreddit = 'catgirlcoin';
const targetSubreddit = 'nyaonearth';
const maintenanceRateReserve = 30;
const verificationAttempts = 6;
const verificationDelayMs = 3_000;

const cfg = redditConfig();
if (cfg.sourceSubreddit.toLowerCase() !== sourceSubreddit) {
  throw new Error('Emoji clone requires REDDIT_SOURCE_SUBREDDIT=catgirlcoin');
}

const catalogueFile = resolve(
  process.cwd(),
  process.env['REDDIT_FLAIR_CATALOGUE_FILE']?.trim() || 'data/flairs.json',
);

const sleep = async (milliseconds: number): Promise<void> => {
  await new Promise<void>(resolvePromise => setTimeout(resolvePromise, milliseconds));
};

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

const byName = (values: readonly RedditEmoji[]): ReadonlyMap<string, RedditEmoji> =>
  new Map(values.map(value => [value.name, value]));

try {
  await requireCompletedBootstrap();

  const read = new RedditReadClient(cfg.auth, { rateReserve: maintenanceRateReserve });
  const write = new RedditMutationClient(cfg.auth, { rateReserve: maintenanceRateReserve });

  const [source, targetBefore] = await Promise.all([
    read.emojis(sourceSubreddit),
    read.emojis(targetSubreddit),
  ]);
  const targetByName = byName(targetBefore);
  const sourceNames = new Set(source.map(emoji => emoji.name));
  const targetExtras = targetBefore.filter(emoji => !sourceNames.has(emoji.name));

  console.log(`Source custom emojis: ${source.length}`);
  console.log(`Target custom emojis before clone: ${targetBefore.length}`);
  if (targetExtras.length > 0) {
    console.log(`Target-only emojis preserved: ${targetExtras.map(emoji => `:${emoji.name}:`).join(', ')}`);
  }

  let uploaded = 0;
  let permissionsUpdated = 0;
  let unchanged = 0;
  const uploadedPreviousUrls = new Map<string, string | null>();

  for (const emoji of source) {
    const current = targetByName.get(emoji.name);
    const [sourceAsset, targetAsset] = await Promise.all([
      downloadEmojiAsset(emoji),
      current === undefined ? Promise.resolve(null) : downloadEmojiAsset(current),
    ]);
    const action = emojiCloneAction(
      emoji,
      current,
      sourceAsset.sha256,
      targetAsset?.sha256 ?? null,
    );

    if (action === 'skip') {
      unchanged += 1;
      console.log(`SKIP  :${emoji.name}: already identical`);
      continue;
    }

    if (action === 'permissions') {
      await write.updateEmojiPermissions(targetSubreddit, emoji);
      permissionsUpdated += 1;
      console.log(`PERMS :${emoji.name}: copied source permissions`);
      continue;
    }

    uploadedPreviousUrls.set(emoji.name, current?.url ?? null);
    await write.uploadEmoji(targetSubreddit, emoji, sourceAsset);
    uploaded += 1;
    console.log(`${current === undefined ? 'ADD   ' : 'IMAGE '} :${emoji.name}: uploaded CatgirlCoin asset`);
  }

  let targetAfter: readonly RedditEmoji[] = [];
  let unresolved: readonly string[] = [];
  let staleAssets: readonly string[] = [];
  for (let attempt = 1; attempt <= verificationAttempts; attempt += 1) {
    targetAfter = await read.emojis(targetSubreddit);
    unresolved = unresolvedEmojiClone(source, targetAfter);
    const afterByName = byName(targetAfter);
    staleAssets = [...uploadedPreviousUrls.entries()]
      .filter(([, oldUrl]) => oldUrl !== null)
      .filter(([name, oldUrl]) => afterByName.get(name)?.url === oldUrl)
      .map(([name]) => `:${name}: asset URL unchanged`)
      .sort((left, right) => left.localeCompare(right));
    if (unresolved.length === 0 && staleAssets.length === 0) break;
    if (attempt < verificationAttempts) await sleep(verificationDelayMs);
  }

  if (unresolved.length > 0 || staleAssets.length > 0) {
    throw new Error(
      `NyaOnEarth emoji verification failed: ${[...unresolved, ...staleAssets].join(', ')}`,
    );
  }

  await requireCompletedBootstrap();

  console.log(`Target custom emojis after clone: ${targetAfter.length}`);
  console.log(`Emoji assets uploaded/replaced: ${uploaded}`);
  console.log(`Emoji permission-only updates: ${permissionsUpdated}`);
  console.log(`Emoji entries already identical: ${unchanged}`);
  console.log(`Target-only emojis preserved: ${targetExtras.length}`);
  console.log('CatgirlCoin -> NyaOnEarth custom emoji clone complete.');
} catch (error) {
  console.error(`Custom emoji clone failed: ${safeError(error)}`);
  process.exitCode = 1;
}
