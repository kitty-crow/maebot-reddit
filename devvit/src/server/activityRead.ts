import type { Community } from './postFeed.ts';

type Json = null | string | number | boolean | Json[] | { readonly [key: string]: Json };
export type ActivityRequest = {
  readonly installation: Community;
  readonly username: string;
  readonly communities: readonly Community[];
  readonly limit: number;
  readonly maxScanned: number;
};
export type ActivityCommentSource = {
  readonly id: string; readonly subredditName: string;
  readonly postId: string; readonly parentId: string;
  readonly authorName: string; readonly body: string;
  readonly permalink: string; readonly createdAt: Date;
  readonly distinguishedBy: string | undefined; readonly stickied: boolean;
  readonly score: number;
};
export type ActivityCommentWire = {
  readonly id: string; readonly fullname: string; readonly subreddit: string;
  readonly submissionFullname: string; readonly parentFullname: string;
  readonly submissionTitle: null; readonly submissionAuthor: null;
  readonly submissionPermalink: null; readonly submissionFlairText: null;
  readonly author: string | null; readonly body: string;
  readonly permalink: string; readonly createdUtc: number;
  readonly distinguished: string | null; readonly stickied: boolean;
  readonly removedByCategory: null; readonly score: number;
  readonly mediaUrls: readonly string[];
};

const namePattern = /^[a-z0-9_-]{1,32}$/iu;
export const parseActivityRequest = (raw: Json): ActivityRequest => {
  if (raw === null || Array.isArray(raw) || typeof raw !== 'object') throw new Error('Invalid comment activity request');
  const installation = raw['installation'];
  if (installation !== 'catgirlcoin' && installation !== 'nyaonearth') {
    throw new Error('Unknown Devvit comment activity installation');
  }
  const username = raw['username'];
  if (typeof username !== 'string' || !namePattern.test(username)) {
    throw new Error('Invalid comment history username');
  }
  const communities = raw['communities'];
  if (!Array.isArray(communities) || communities.length < 1 || communities.length > 2) {
    throw new Error('Invalid activity community set');
  }
  const names = communities.map(item => {
    if (item !== 'catgirlcoin' && item !== 'nyaonearth') throw new Error('Activity outside approved communities');
    return item;
  });
  if (new Set(names).size !== names.length) throw new Error('Duplicate activity community');
  const limit = raw['limit'];
  const maxScanned = raw['maxScanned'];
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Invalid activity result limit');
  }
  if (typeof maxScanned !== 'number' || !Number.isInteger(maxScanned)
    || maxScanned < limit || maxScanned > 1000) {
    throw new Error('Invalid activity history scan limit');
  }
  if (Object.keys(raw).some(key => !['installation','username','communities','limit','maxScanned'].includes(key))) {
    throw new Error('Unexpected comment history request parameter');
  }
  return { installation, username, communities:names, limit, maxScanned };
};
const projectActivityComment = (row: ActivityCommentSource): ActivityCommentWire => {
  if (!/^t1_[a-z0-9]+$/iu.test(row.id) || !/^t3_[a-z0-9]+$/iu.test(row.postId)
    || !/^t[13]_[a-z0-9]+$/iu.test(row.parentId)) {
    throw new Error('Devvit activity comment identifier invalid');
  }
  const date = row.createdAt.getTime();
  if (!Number.isFinite(date) || !Number.isFinite(row.score)) throw new Error('Devvit comment metadata invalid');
  return {
    id:row.id.slice(3),fullname:row.id,subreddit:row.subredditName,
    submissionFullname:row.postId,parentFullname:row.parentId,
    submissionTitle:null,submissionAuthor:null,submissionPermalink:null,
    submissionFlairText:null,
    author:row.authorName === '[deleted]' ? null : row.authorName,
    body:row.body,permalink:row.permalink,createdUtc:date/1000,
    distinguished:row.distinguishedBy ?? null,stickied:row.stickied,
    removedByCategory:null,score:Math.floor(row.score),mediaUrls:[],
  };
};
export const projectRecentComments = (
  source:readonly ActivityCommentSource[], request:ActivityRequest,
): readonly ActivityCommentWire[] => {
  if (source.length > request.maxScanned) throw new Error('Devvit comment scan exceeded maximum');
  const wanted = new Set(request.communities);
  const out: ActivityCommentWire[] = [];
  const seen = new Set<string>();
  for (const comment of source) {
    if (!wanted.has(comment.subredditName.toLowerCase() as Community)) continue;
    const row = projectActivityComment(comment);
    if (seen.has(row.fullname)) throw new Error('Duplicate Reddit comment in activity listing');
    seen.add(row.fullname);
    out.push(row);
    if (out.length >= request.limit) break;
  }
  return out;
};
