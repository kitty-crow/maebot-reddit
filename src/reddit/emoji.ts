import type { Json, JsonMap } from '../types/json.ts';
import { isMap } from '../types/json.ts';
import { RedditError } from './error.ts';

export type RedditEmoji = {
  readonly name: string;
  readonly url: string;
  readonly modFlairOnly: boolean;
  readonly postFlairAllowed: boolean;
  readonly userFlairAllowed: boolean;
};

export type RedditEmojiUploadLease = {
  readonly uploadUrl: string;
  readonly fields: ReadonlyMap<string, string>;
  readonly key: string;
};

const requiredText = (value: Json | undefined, field: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RedditError(`Reddit emoji ${field} is missing`, 'invalid_response');
  }
  return value;
};

const requiredFlag = (value: Json | undefined, field: string): boolean => {
  if (typeof value !== 'boolean') {
    throw new RedditError(`Reddit emoji ${field} is missing`, 'invalid_response');
  }
  return value;
};

const emojiFrom = (name: string, value: Json): RedditEmoji => {
  if (!isMap(value)) throw new RedditError(`Reddit emoji ${name} is not an object`, 'invalid_response');
  return {
    name,
    url: requiredText(value['url'], `${name} url`),
    modFlairOnly: requiredFlag(value['mod_flair_only'], `${name} mod_flair_only`),
    postFlairAllowed: requiredFlag(value['post_flair_allowed'], `${name} post_flair_allowed`),
    userFlairAllowed: requiredFlag(value['user_flair_allowed'], `${name} user_flair_allowed`),
  };
};

export const redditEmojis = (value: Json): readonly RedditEmoji[] => {
  if (!isMap(value)) throw new RedditError('Reddit emoji inventory is not an object', 'invalid_response');
  const subredditEntries = Object.entries(value).filter(([key, raw]) => key.startsWith('t5_') && isMap(raw));
  if (subredditEntries.length !== 1) {
    throw new RedditError(`Reddit emoji inventory expected one subreddit entry, found ${subredditEntries.length}`, 'invalid_response');
  }
  const entry = subredditEntries[0];
  if (entry === undefined || !isMap(entry[1])) {
    throw new RedditError('Reddit emoji subreddit inventory disappeared', 'invalid_response');
  }
  return Object.entries(entry[1])
    .map(([name, raw]) => emojiFrom(name, raw))
    .sort((left, right) => left.name.localeCompare(right.name));
};

const leaseFields = (value: Json): ReadonlyMap<string, string> => {
  if (!Array.isArray(value)) throw new RedditError('Reddit emoji upload lease fields are missing', 'invalid_response');
  const fields = new Map<string, string>();
  for (const raw of value) {
    if (!isMap(raw)) throw new RedditError('Reddit emoji upload lease contains an invalid field', 'invalid_response');
    const name = requiredText(raw['name'], 'upload lease field name');
    const fieldValue = requiredText(raw['value'], `upload lease field ${name}`);
    if (fields.has(name)) throw new RedditError(`Reddit emoji upload lease repeats field ${name}`, 'invalid_response');
    fields.set(name, fieldValue);
  }
  return fields;
};

const uploadUrl = (action: string): string => {
  const candidate = action.startsWith('//') ? `https:${action}` : action;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new RedditError('Reddit emoji upload lease returned an invalid S3 URL', 'invalid_response');
  }
  if (url.protocol !== 'https:') {
    throw new RedditError('Reddit emoji upload lease returned a non-HTTPS S3 URL', 'invalid_response');
  }
  return url.toString();
};

export const redditEmojiUploadLease = (value: Json): RedditEmojiUploadLease => {
  if (!isMap(value) || !isMap(value['s3UploadLease'])) {
    throw new RedditError('Reddit emoji upload lease is missing', 'invalid_response');
  }
  const lease: JsonMap = value['s3UploadLease'];
  const fields = leaseFields(lease['fields']);
  const key = fields.get('key');
  if (key === undefined || key.length === 0) {
    throw new RedditError('Reddit emoji upload lease did not contain an S3 key', 'invalid_response');
  }
  return {
    uploadUrl: uploadUrl(requiredText(lease['action'], 'upload lease action')),
    fields,
    key,
  };
};

export const sameEmojiPermissions = (left: RedditEmoji, right: RedditEmoji): boolean =>
  left.modFlairOnly === right.modFlairOnly
  && left.postFlairAllowed === right.postFlairAllowed
  && left.userFlairAllowed === right.userFlairAllowed;
