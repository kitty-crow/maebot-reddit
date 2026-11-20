import { parseMap, type Json } from '../types/json.ts';
import { arrVal, mapVal, numVal, strVal } from '../types/value.ts';
import type { RedditFlairAssignment, RedditFlairTemplate } from './types.ts';
import type { DevvitCommunity } from './devvitPostFeed.ts';

export type DevvitFlairKind = 'user-templates' | 'post-templates' | 'user-assignments' | 'user-assignment';
const maxBody = 4_194_304;

const root = (body: string, subreddit: DevvitCommunity, kind: DevvitFlairKind) => {
  if (body.length > maxBody) throw new Error('Devvit flair response exceeds safe limit');
  const data = parseMap(body);
  if (data['protocol'] !== 1 || data['subreddit'] !== subreddit || data['kind'] !== kind) {
    throw new Error('Devvit flair response does not match expected installation or operation');
  }
  return data;
};
const strOrNull = (value: Json | undefined, name: string): string | null => {
  if (value === null) return null;
  return strVal(value, name);
};
const colour = (raw: Json | undefined, label: string): string => {
  const value = strVal(raw, label);
  if (value !== 'transparent' && !/^#[0-9a-f]{6}$/iu.test(value)) {
    throw new Error('Invalid flair background colour');
  }
  return value;
};
const asTemplate = (value: Json, index: number): RedditFlairTemplate => {
  const data = mapVal(value, 'Devvit template ' + index);
  const id = strVal(data['id'], 'flair.id');
  if (!/^[0-9a-f-]{8,64}$/iu.test(id)) throw new Error('Invalid flair template ID');
  const text = strVal(data['text'], 'flair.text');
  const textColour = strVal(data['textColour'], 'flair.textColour');
  if (textColour !== 'light' && textColour !== 'dark') throw new Error('Invalid flair text colour');
  const allowableContent = strVal(data['allowableContent'], 'flair.allowableContent');
  if (allowableContent !== 'all' && allowableContent !== 'emoji' && allowableContent !== 'text') {
    throw new Error('Invalid flair content');
  }
  const maxEmojis = numVal(data['maxEmojis'], 'flair.maxEmojis');
  if (!Number.isInteger(maxEmojis) || maxEmojis < 0 || maxEmojis > 10) {
    throw new Error('Invalid maximum flair emojis');
  }
  const modOnly = data['modOnly'];
  const textEditable = data['textEditable'];
  if (typeof modOnly !== 'boolean' || typeof textEditable !== 'boolean') {
    throw new Error('Invalid flair template flags');
  }
  // The SDK omits css_class. Returning null matches Mae's legacy decoder semantics
  // for omitted classes, but these previews are not fully lossless.
  if (data['cssClass'] !== null) throw new Error('Flair template CSS class must be explicit null');
  return {
    id, text, cssClass: null, textColour, backgroundColour: colour(data['backgroundColour'], 'flair.backgroundColour'),
    modOnly, textEditable, allowableContent, maxEmojis,
  };
};
const asAssignment = (value: Json, index: number): RedditFlairAssignment => {
  const data = mapVal(value, 'Devvit assignment ' + index);
  const username = strVal(data['username'], 'flair.username');
  if (!/^[a-z0-9_-]{2,32}$/iu.test(username)) throw new Error('Invalid flair assignment username');
  if (data['templateId'] !== null) throw new Error('Unverifiable assignment template ID');
  return {
    username,
    templateId: null,
    text: strOrNull(data['text'], 'flair.text'),
    cssClass: strOrNull(data['cssClass'], 'flair.cssClass'),
  };
};
const distinct = <T extends { readonly username: string }>(values: readonly T[]): readonly T[] => {
  const seen = new Set<string>();
  for (const value of values) {
    const name = value.username.toLowerCase();
    if (seen.has(name)) throw new Error('Duplicate Devvit user flair assignment');
    seen.add(name);
  }
  return values;
};

export const parseDevvitFlairTemplates = (
  body: string, subreddit: DevvitCommunity, kind: 'user-templates' | 'post-templates',
): readonly RedditFlairTemplate[] => {
  const data = root(body, subreddit, kind);
  const templates = arrVal(data['templates'], 'Devvit flair templates');
  if (templates.length > 1000) throw new Error('Excessive Devvit flair templates');
  const values = templates.map(asTemplate);
  const seen = new Set<string>();
  for (const item of values) {
    if (seen.has(item.id)) throw new Error('Duplicate Devvit flair template');
    seen.add(item.id);
  }
  return values;
};
export const parseDevvitFlairAssignments = (
  body: string, subreddit: DevvitCommunity,
): readonly RedditFlairAssignment[] => {
  const data = root(body, subreddit, 'user-assignments');
  const values = arrVal(data['assignments'], 'Devvit flair assignments');
  if (values.length > 10_000) throw new Error('Excessive Devvit flair assignments');
  return distinct(values.map(asAssignment));
};
export const parseDevvitFlairAssignment = (
  body: string, subreddit: DevvitCommunity, username: string,
): RedditFlairAssignment | null => {
  const data = root(body, subreddit, 'user-assignment');
  if (data['assignment'] === null) return null;
  const value = asAssignment(data['assignment'] ?? null, 0);
  if (value.username.toLowerCase() !== username.toLowerCase()) {
    throw new Error('Devvit flair assignment did not match requested user');
  }
  return value;
};
