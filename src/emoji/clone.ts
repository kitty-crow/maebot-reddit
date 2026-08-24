import { createHash } from 'node:crypto';
import { sameEmojiPermissions, type RedditEmoji } from '../reddit/emoji.ts';
import type { RedditEmojiMedia } from '../reddit/mutate.ts';

export type EmojiAssetFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type EmojiAsset = RedditEmojiMedia & {
  readonly sha256: string;
};

export type EmojiCloneAction = 'skip' | 'permissions' | 'upload';

const maxEmojiBytes = 5 * 1024 * 1024;

const trustedEmojiUrl = (raw: string): URL => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid Reddit emoji asset URL ${raw}`);
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || (host !== 'redditmedia.com' && !host.endsWith('.redditmedia.com'))) {
    throw new Error(`Refusing non-Reddit emoji asset URL ${raw}`);
  }
  return url;
};

const canonicalMime = (response: Response, url: URL): 'image/png' | 'image/jpeg' => {
  const header = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (header === 'image/png') return 'image/png';
  if (header === 'image/jpeg' || header === 'image/jpg') return 'image/jpeg';
  const path = url.pathname.toLowerCase();
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  throw new Error(`Unsupported Reddit emoji image type ${header ?? '(missing)'}`);
};

const filename = (name: string, mimeType: 'image/png' | 'image/jpeg'): string =>
  `${name}.${mimeType === 'image/png' ? 'png' : 'jpg'}`;

export const downloadEmojiAsset = async (
  emoji: RedditEmoji,
  fetcher: EmojiAssetFetch = fetch,
): Promise<EmojiAsset> => {
  const url = trustedEmojiUrl(emoji.url);
  let response: Response;
  try {
    response = await fetcher(url);
  } catch {
    throw new Error(`Failed to download Reddit emoji :${emoji.name}:`);
  }
  if (!response.ok) throw new Error(`Reddit emoji :${emoji.name}: download returned HTTP ${response.status}`);
  const mimeType = canonicalMime(response, url);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0) throw new Error(`Reddit emoji :${emoji.name}: downloaded empty`);
  if (bytes.byteLength > maxEmojiBytes) {
    throw new Error(`Reddit emoji :${emoji.name}: exceeds ${maxEmojiBytes} byte clone safety limit`);
  }
  return {
    bytes,
    filename: filename(emoji.name, mimeType),
    mimeType,
    sha256: createHash('sha256').update(new Uint8Array(bytes)).digest('hex'),
  };
};

export const emojiCloneAction = (
  source: RedditEmoji,
  target: RedditEmoji | undefined,
  sourceSha256: string,
  targetSha256: string | null,
): EmojiCloneAction => {
  if (target === undefined || targetSha256 === null || sourceSha256 !== targetSha256) return 'upload';
  return sameEmojiPermissions(source, target) ? 'skip' : 'permissions';
};

export const unresolvedEmojiClone = (
  source: readonly RedditEmoji[],
  target: readonly RedditEmoji[],
): readonly string[] => {
  const byName = new Map(target.map(emoji => [emoji.name, emoji]));
  const unresolved: string[] = [];
  for (const emoji of source) {
    const current = byName.get(emoji.name);
    if (current === undefined) {
      unresolved.push(`:${emoji.name}: missing`);
      continue;
    }
    if (!sameEmojiPermissions(emoji, current)) unresolved.push(`:${emoji.name}: permissions differ`);
  }
  return unresolved.sort((left, right) => left.localeCompare(right));
};
