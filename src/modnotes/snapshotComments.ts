import type { RedditComment } from '../reddit/types.ts';
import { isMap, type Json } from '../types/json.ts';

const canonical = new Set(['catgirlcoin', 'nyaonearth']);

const text = (value: Json | undefined): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const integer = (value: Json | undefined): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null;

const subredditFromPermalink = (permalink: string): string | null => {
  const match = /^\/r\/([^/]+)\//iu.exec(permalink.trim());
  if (match === null || match[1] === undefined) return null;
  const value = match[1].toLowerCase();
  return canonical.has(value) ? value : null;
};

export const snapshotCommentsForMember = (
  raw: Json,
  username: string,
  limit = 10,
): readonly RedditComment[] => {
  if (!isMap(raw)) throw new Error('Reputation snapshot root is invalid');
  const contributions = raw['contributions'];
  if (!isMap(contributions)) throw new Error('Reputation snapshot contributions map is missing');

  const wanted = username.trim().toLowerCase();
  const out: RedditComment[] = [];

  for (const value of Object.values(contributions)) {
    if (!isMap(value) || value['kind'] !== 'comment') continue;
    const author = text(value['author']);
    const fullname = text(value['fullname']);
    const permalink = text(value['permalink']);
    const body = typeof value['content'] === 'string' ? value['content'] : null;
    const createdUtc = integer(value['createdAt']);
    const score = integer(value['creditedScore']) ?? integer(value['lastObservedScore']) ?? 0;
    if (
      author === null || author.toLowerCase() !== wanted
      || fullname === null || !/^t1_[A-Za-z0-9]+$/u.test(fullname)
      || permalink === null || body === null || createdUtc === null
    ) continue;
    const subreddit = subredditFromPermalink(permalink);
    if (subreddit === null) continue;

    out.push({
      id: fullname.slice(3),
      fullname,
      subreddit,
      submissionFullname: 't3_snapshot',
      author,
      body,
      permalink,
      createdUtc,
      distinguished: null,
      stickied: false,
      removedByCategory: null,
      score,
      mediaUrls: [],
    });
  }

  return out
    .sort((left, right) => right.createdUtc - left.createdUtc || left.fullname.localeCompare(right.fullname))
    .slice(0, Math.max(1, Math.min(100, Math.floor(limit))));
};
