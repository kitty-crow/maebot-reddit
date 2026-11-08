import { parseMap, type Json } from '../types/json.ts';
import { arrVal, boolVal, mapVal, numVal, strVal } from '../types/value.ts';
import type { RedditComment } from './types.ts';
import type { DevvitCommunity } from './devvitPostFeed.ts';

export type DevvitActivityRequest = {
  readonly installation: DevvitCommunity;
  readonly username: string;
  readonly communities: readonly DevvitCommunity[];
  readonly limit: number;
  readonly maxScanned: number;
};

const optionalString = (value: Json | undefined, name: string): string | null => {
  if (value === null) return null;
  return strVal(value,name);
};
const omittedMetadata = (row: Readonly<Record<string,Json>>): void => {
  for (const key of ['submissionTitle','submissionAuthor','submissionPermalink',
    'submissionFlairText','removedByCategory']) {
    if (row[key] !== null) throw new Error('Devvit comment preview fabricated unavailable '+key);
  }
  if (arrVal(row['mediaUrls'],'activity.mediaUrls').length !== 0) {
    throw new Error('Devvit activity preview unexpectedly contains media links');
  }
};
const parseComment = (raw:Json, request:DevvitActivityRequest): RedditComment => {
  const row=mapVal(raw,'Devvit activity comment');
  const fullname=strVal(row['fullname'],'comment.fullname');
  const id=strVal(row['id'],'comment.id');
  if (!/^t1_[a-z0-9]+$/iu.test(fullname) || fullname !== 't1_'+id) {
    throw new Error('Devvit comment identity invalid');
  }
  const subreddit=strVal(row['subreddit'],'comment.subreddit');
  if (!request.communities.some(name=>name===subreddit.toLowerCase())) {
    throw new Error('Devvit comment outside approved community set');
  }
  omittedMetadata(row);
  const createdUtc=numVal(row['createdUtc'],'comment.createdUtc');
  const score=numVal(row['score'],'comment.score');
  if (!Number.isFinite(createdUtc) || !Number.isInteger(score)) {
    throw new Error('Invalid Devvit activity comment numbers');
  }
  const submissionFullname=strVal(row['submissionFullname'],'comment.submissionFullname');
  const parentFullname=strVal(row['parentFullname'],'comment.parentFullname');
  if (!/^t3_[a-z0-9]+$/iu.test(submissionFullname) || !/^t[13]_[a-z0-9]+$/iu.test(parentFullname)) {
    throw new Error('Invalid Devvit activity comment context IDs');
  }
  return {
    id,fullname,subreddit,submissionFullname,parentFullname,
    submissionTitle:null,submissionAuthor:null,submissionPermalink:null,submissionFlairText:null,
    author:optionalString(row['author'],'comment.author'),
    body:strVal(row['body'],'comment.body'),
    permalink:strVal(row['permalink'],'comment.permalink'),
    createdUtc,distinguished:optionalString(row['distinguished'],'comment.distinguished'),
    stickied:boolVal(row['stickied'],'comment.stickied'),
    removedByCategory:null,score,mediaUrls:[],
  };
};
export const parseDevvitRecentComments = (
  body:string, request:DevvitActivityRequest,
): readonly RedditComment[] => {
  if (body.length > 1_048_576) throw new Error('Devvit comment activity response too large');
  const data=parseMap(body);
  if (data['protocol'] !== 1 || data['installation'] !== request.installation
    || data['username'] !== request.username) {
    throw new Error('Devvit comment activity installation or user mismatch');
  }
  const rows=arrVal(data['comments'],'Devvit activity comments');
  if (rows.length > request.limit) throw new Error('Devvit activity exceeded requested result count');
  const seen=new Set<string>();
  return rows.map((raw):RedditComment=>{
    const item=parseComment(raw,request);
    if (seen.has(item.fullname)) throw new Error('Duplicate Devvit activity comment');
    seen.add(item.fullname);
    return item;
  });
};
