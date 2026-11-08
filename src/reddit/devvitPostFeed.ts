import { parseMap } from '../types/json.ts';
import { arrVal, boolVal, mapVal, numVal, optStr, strVal } from '../types/value.ts';
import type { RedditPost } from './types.ts';

export type DevvitPostFeed = 'new' | 'hot';
export type DevvitCommunity = 'catgirlcoin' | 'nyaonearth';
export type DevvitPostFeedRequest = {
  readonly subreddit: DevvitCommunity;
  readonly feed: DevvitPostFeed;
  readonly limit: number;
};

export const parseDevvitPostFeed = (body: string, request: DevvitPostFeedRequest): readonly RedditPost[] => {
  if (body.length > 524_288) throw new Error('Devvit feed response exceeds safe maximum');
  const root = parseMap(body);
  if (root['protocol'] !== 1 || root['feed'] !== request.feed || root['subreddit'] !== request.subreddit) {
    throw new Error('Devvit feed protocol or community mismatch');
  }
  const rows = arrVal(root['posts'], 'Devvit posts');
  if (rows.length > request.limit) throw new Error('Devvit feed exceeded requested limit');
  const seen = new Set<string>();
  return rows.map((value, index): RedditPost => {
    const row = mapVal(value, 'Devvit post ' + index);
    const id = strVal(row['id'], 'post.id');
    const fullname = strVal(row['fullname'], 'post.fullname');
    const subreddit = strVal(row['subreddit'], 'post.subreddit');
    if (!/^[a-z0-9]+$/iu.test(id) || fullname !== 't3_' + id
        || subreddit.toLowerCase() !== request.subreddit || seen.has(fullname)) {
      throw new Error('Devvit post identity or community mismatch');
    }
    seen.add(fullname);
    const mediaUrls = arrVal(row['mediaUrls'], 'post.mediaUrls').map((url): string => {
      const value = strVal(url, 'post.mediaUrl');
      if (!/^https?:\/\//iu.test(value)) throw new Error('Invalid Devvit post media URL');
      return value;
    });
    if (mediaUrls.length > 12) throw new Error('Too many Devvit post media URLs');
    const author = row['author'];
    if (author !== null && typeof author !== 'string') throw new Error('Invalid Devvit post author');
    const score = numVal(row['score'], 'post.score');
    const createdUtc = numVal(row['createdUtc'], 'post.createdUtc');
    if (!Number.isInteger(score) || !Number.isFinite(createdUtc)) {
      throw new Error('Invalid Devvit post number');
    }
    return {
      id,
      fullname,
      subreddit,
      title: strVal(row['title'], 'post.title'),
      author: author,
      permalink: strVal(row['permalink'], 'post.permalink'),
      createdUtc,
      selfText: strVal(row['selfText'], 'post.selfText'),
      url: strVal(row['url'], 'post.url'),
      flairTemplateId: optStr(row['flairTemplateId']),
      flairText: optStr(row['flairText']),
      stickied: boolVal(row['stickied'], 'post.stickied'),
      locked: boolVal(row['locked'], 'post.locked'),
      over18: boolVal(row['over18'], 'post.over18'),
      crosspostParent: optStr(row['crosspostParent']),
      score,
      mediaUrls,
    };
  });
};
