import { downloadEmojiAsset, emojiCloneAction, unresolvedEmojiClone } from './clone.ts';
import type { RedditReadClient } from '../reddit/client.ts';
import type { RedditEmoji } from '../reddit/emoji.ts';
import type { RedditMutationClient } from '../reddit/mutate.ts';
import { assertModeratorPermissions } from '../reddit/permissions.ts';

export type CommunityEmojiCloneResult = {
  readonly sourceCount: number;
  readonly targetBeforeCount: number;
  readonly targetAfterCount: number;
  readonly uploaded: number;
  readonly permissionsUpdated: number;
  readonly unchanged: number;
  readonly targetOnlyPreserved: number;
};

export type CommunityEmojiCloneOptions = {
  readonly verificationAttempts?: number;
  readonly verificationDelayMs?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly log?: (message: string) => void;
};

export type CommunityEmojiCloneClients = {
  readonly sourceRead: RedditReadClient;
  readonly targetRead: RedditReadClient;
  readonly targetWrite: RedditMutationClient;
};

const byName = (values: readonly RedditEmoji[]): ReadonlyMap<string, RedditEmoji> =>
  new Map(values.map(value => [value.name, value]));

const defaultSleep = async (milliseconds: number): Promise<void> => {
  await new Promise<void>(resolvePromise => setTimeout(resolvePromise, milliseconds));
};

export const cloneCommunityEmojis = async (
  clients: CommunityEmojiCloneClients,
  sourceSubreddit: string,
  targetSubreddit: string,
  options: CommunityEmojiCloneOptions = {},
): Promise<CommunityEmojiCloneResult> => {
  const verificationAttempts = Math.max(1, Math.min(10, Math.floor(options.verificationAttempts ?? 6)));
  const verificationDelayMs = Math.max(0, Math.min(30_000, Math.floor(options.verificationDelayMs ?? 3_000)));
  const sleep = options.sleep ?? defaultSleep;
  const log = options.log ?? (() => undefined);

  // The target-side emoji client is intentionally allowed to be a different
  // Reddit identity from Mae. Custom emoji mutation is a subreddit
  // appearance/settings operation and therefore requires Manage Settings
  // (`config`) on the target community. Verify that exact authenticated
  // identity before inventory/download/write work starts.
  const [operator, targetModerators] = await Promise.all([
    clients.targetRead.me(),
    clients.targetRead.moderators(targetSubreddit),
  ]);
  assertModeratorPermissions(operator.name, targetSubreddit, targetModerators, ['config']);
  log(`Target emoji operator: u/${operator.name}`);

  const [source, targetBefore] = await Promise.all([
    clients.sourceRead.emojis(sourceSubreddit),
    clients.targetRead.emojis(targetSubreddit),
  ]);
  const targetByName = byName(targetBefore);
  const sourceNames = new Set(source.map(emoji => emoji.name));
  const targetExtras = targetBefore.filter(emoji => !sourceNames.has(emoji.name));

  log(`Source custom emojis: ${source.length}`);
  log(`Target custom emojis before clone: ${targetBefore.length}`);
  if (targetExtras.length > 0) {
    log(`Target-only emojis preserved: ${targetExtras.map(emoji => `:${emoji.name}:`).join(', ')}`);
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
      log(`SKIP  :${emoji.name}: already identical`);
      continue;
    }

    if (action === 'permissions') {
      await clients.targetWrite.updateEmojiPermissions(targetSubreddit, emoji);
      permissionsUpdated += 1;
      log(`PERMS :${emoji.name}: copied source permissions`);
      continue;
    }

    uploadedPreviousUrls.set(emoji.name, current?.url ?? null);
    await clients.targetWrite.uploadEmoji(targetSubreddit, emoji, sourceAsset);
    uploaded += 1;
    log(`${current === undefined ? 'ADD   ' : 'IMAGE '} :${emoji.name}: uploaded source asset`);
  }

  let targetAfter: readonly RedditEmoji[] = [];
  let unresolved: readonly string[] = [];
  let staleAssets: readonly string[] = [];
  for (let attempt = 1; attempt <= verificationAttempts; attempt += 1) {
    targetAfter = await clients.targetRead.emojis(targetSubreddit);
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
      `${targetSubreddit} emoji verification failed: ${[...unresolved, ...staleAssets].join(', ')}`,
    );
  }

  return {
    sourceCount: source.length,
    targetBeforeCount: targetBefore.length,
    targetAfterCount: targetAfter.length,
    uploaded,
    permissionsUpdated,
    unchanged,
    targetOnlyPreserved: targetExtras.length,
  };
};
