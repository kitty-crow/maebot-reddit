import { parseMap } from '../types/json.ts';
import { arrVal, boolVal, mapVal, numVal, strVal } from '../types/value.ts';
import type { RedditSubreddit, RedditThingScore } from './types.ts';
import type { DevvitCommunity } from './devvitPostFeed.ts';

export type DevvitInspectionRequest =
  | { readonly subreddit: DevvitCommunity; readonly kind: 'subreddit' }
  | { readonly subreddit: DevvitCommunity; readonly kind: 'post-scores'; readonly fullnames: readonly string[] };

const verifiedRoot = (body: string, request: DevvitInspectionRequest) => {
  if (body.length > 65_536) throw new Error('Devvit inspection response exceeds limit');
  const root = parseMap(body);
  if (root['protocol'] !== 1 || root['subreddit'] !== request.subreddit || root['kind'] !== request.kind) {
    throw new Error('Devvit inspection response identity or protocol mismatch');
  }
  return root;
};
const nonNegativeCount = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid ' + label);
  return value;
};

export const parseDevvitSubreddit = (
  body: string, subreddit: DevvitCommunity,
): RedditSubreddit => {
  const data = mapVal(verifiedRoot(body,{kind:'subreddit',subreddit})['data'],'Devvit subreddit');
  const id = strVal(data['id'],'subreddit.id');
  const name = strVal(data['name'],'subreddit.name');
  if (!/^t5_[a-z0-9]+$/iu.test(id) || name.toLowerCase() !== subreddit) {
    throw new Error('Devvit subreddit identity mismatch');
  }
  const type = strVal(data['submissionType'],'subreddit.submissionType');
  if (type !== 'any' && type !== 'link' && type !== 'self' && type !== 'other') {
    throw new Error('Unexpected Devvit subreddit post type');
  }
  return {
    id, name, title:strVal(data['title'],'subreddit.title'),
    subscribers:nonNegativeCount(numVal(data['subscribers'],'subreddit.subscribers'),'subscriber count'),
    userIsModerator:boolVal(data['userIsModerator'],'subreddit.userIsModerator'),
    userFlairEnabled:boolVal(data['userFlairEnabled'],'subreddit.userFlairEnabled'),
    userFlairSelfAssign:boolVal(data['userFlairSelfAssign'],'subreddit.userFlairSelfAssign'),
    linkFlairEnabled:boolVal(data['linkFlairEnabled'],'subreddit.linkFlairEnabled'),
    over18:boolVal(data['over18'],'subreddit.over18'),submissionType:type,
  };
};
export const parseDevvitPostScores = (
  body: string, request: Extract<DevvitInspectionRequest,{readonly kind:'post-scores'}>,
): readonly RedditThingScore[] => {
  if (request.fullnames.length < 1 || request.fullnames.length > 25) throw new Error('Invalid Devvit score inventory size');
  const rows=arrVal(verifiedRoot(body,request)['scores'],'Devvit post scores');
  if (rows.length !== request.fullnames.length) throw new Error('Incomplete Devvit post score batch');
  return rows.map((raw,index): RedditThingScore => {
    const row=mapVal(raw,'Devvit post score');
    const fullname=strVal(row['fullname'],'score.fullname');
    if (fullname !== request.fullnames[index] || !/^t3_[a-z0-9]+$/iu.test(fullname)) {
      throw new Error('Devvit post score identity mismatch');
    }
    const score=numVal(row['score'],'score.score');
    if (!Number.isInteger(score)) throw new Error('Invalid Devvit post score');
    return {fullname,score,archived:boolVal(row['archived'],'score.archived')};
  });
};
