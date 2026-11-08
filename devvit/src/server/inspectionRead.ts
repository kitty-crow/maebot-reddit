import type { Community } from './postFeed.ts';

type Json = null | boolean | number | string | Json[] | { readonly [key: string]: Json };
export type InspectionRequest =
  | { readonly subreddit: Community; readonly kind: 'subreddit' }
  | { readonly subreddit: Community; readonly kind: 'post-scores'; readonly fullnames: readonly string[] };

export type SubredditSource = {
  readonly id: string;
  readonly name: string;
  readonly title: string | undefined;
  readonly numberOfSubscribers: number;
  readonly userFlairsEnabled: boolean;
  readonly usersCanAssignUserFlairs: boolean;
  readonly postFlairsEnabled: boolean;
  readonly nsfw: boolean;
  readonly settings: { readonly allowedPostType: 'any' | 'link' | 'self' | 'other' };
};
export type SubredditWire = {
  readonly id: string; readonly name: string; readonly title: string;
  readonly subscribers: number; readonly userIsModerator: boolean;
  readonly userFlairEnabled: boolean; readonly userFlairSelfAssign: boolean;
  readonly linkFlairEnabled: boolean; readonly over18: boolean;
  readonly submissionType: 'any' | 'link' | 'self' | 'other';
};
export type PostScoreSource = {
  readonly id: string; readonly subredditName: string;
  readonly score: number; readonly archived: boolean;
};
export type PostScoreWire = {
  readonly fullname: string; readonly score: number; readonly archived: boolean;
};

const fullnamePattern = /^t3_[a-z0-9]+$/iu;
const subIdPattern = /^t5_[a-z0-9]+$/iu;
const allowed = (raw: Readonly<Record<string, Json>>, keys: readonly string[]): void => {
  if (Object.keys(raw).some(key => !keys.includes(key))) throw new Error('Unexpected inspection field');
};
const nameFrom = (value: Json): string => {
  if (typeof value !== 'string' || !fullnamePattern.test(value)) {
    throw new Error('Only full post IDs are supported by the Devvit score preview');
  }
  return value;
};
export const parseInspectionRequest = (raw: Json): InspectionRequest => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid Reddit inspection request');
  }
  const subreddit = raw['subreddit'];
  if (subreddit !== 'catgirlcoin' && subreddit !== 'nyaonearth') {
    throw new Error('Unrecognised Reddit inspection community');
  }
  const kind = raw['kind'];
  if (kind === 'subreddit') {
    allowed(raw, ['subreddit', 'kind']);
    return { subreddit, kind };
  }
  if (kind !== 'post-scores') throw new Error('Unrecognised Reddit inspection kind');
  allowed(raw, ['subreddit', 'kind', 'fullnames']);
  const fullnames = raw['fullnames'];
  if (!Array.isArray(fullnames) || fullnames.length < 1 || fullnames.length > 25) {
    throw new Error('Devvit post score batch is limited to 25');
  }
  const names = fullnames.map(nameFrom);
  if (new Set(names).size !== names.length) throw new Error('Duplicate post ID in score batch');
  return { subreddit, kind, fullnames: names };
};
export const projectSubreddit = (
  source: SubredditSource, subreddit: Community, userIsModerator: boolean,
): SubredditWire => {
  if (!subIdPattern.test(source.id) || source.name.toLowerCase() !== subreddit) {
    throw new Error('Devvit subreddit installation identity mismatch');
  }
  const title = source.title;
  if (title === undefined) throw new Error('Devvit subreddit title unavailable');
  if (!Number.isSafeInteger(source.numberOfSubscribers) || source.numberOfSubscribers < 0) {
    throw new Error('Devvit subreddit subscriber count invalid');
  }
  return {
    id: source.id, name: source.name, title,
    subscribers: source.numberOfSubscribers, userIsModerator,
    userFlairEnabled: source.userFlairsEnabled,
    userFlairSelfAssign: source.usersCanAssignUserFlairs,
    linkFlairEnabled: source.postFlairsEnabled, over18: source.nsfw,
    submissionType: source.settings.allowedPostType,
  };
};
export const projectPostScore = (
  source: PostScoreSource, subreddit: Community, fullname: string,
): PostScoreWire => {
  if (source.id !== fullname || source.subredditName.toLowerCase() !== subreddit) {
    throw new Error('Devvit post score returned another post or community');
  }
  if (!Number.isFinite(source.score)) throw new Error('Devvit post score is not finite');
  return { fullname, score: Math.floor(source.score), archived: source.archived };
};
