import type { Community } from './postFeed.ts';

type Json = null | boolean | number | string | Json[] | { readonly [key: string]: Json };
export type FlairKind = 'user-templates' | 'post-templates' | 'user-assignments' | 'user-assignment';
export type FlairRequest = {
  readonly subreddit: Community;
  readonly kind: FlairKind;
  readonly username: string | null;
};
export type FlairTemplateSource = {
  readonly id: string;
  readonly text: string;
  readonly textColor: 'light' | 'dark';
  readonly backgroundColor: string;
  readonly modOnly: boolean;
  readonly allowUserEdits: boolean;
  readonly allowableContent: 'all' | 'text' | 'emoji';
  readonly maxEmojis: number;
};
export type FlairAssignmentSource = {
  readonly user?: string | undefined;
  readonly flairText?: string | undefined;
  readonly flairCssClass?: string | undefined;
};
export type FlairAssignmentPage = {
  readonly users: readonly FlairAssignmentSource[];
  readonly next?: string | undefined;
};
export type FlairAssignmentReader = {
  getUserFlair(options: { readonly limit: number; readonly after?: string }): Promise<FlairAssignmentPage>;
};
export type FlairTemplateWire = {
  readonly id: string;
  readonly text: string;
  readonly cssClass: null;
  readonly textColour: 'light' | 'dark';
  readonly backgroundColour: string;
  readonly modOnly: boolean;
  readonly textEditable: boolean;
  readonly allowableContent: 'all' | 'text' | 'emoji';
  readonly maxEmojis: number;
};
export type FlairAssignmentWire = {
  readonly username: string;
  readonly templateId: null;
  readonly text: string | null;
  readonly cssClass: string | null;
};

const usernamePattern = /^[a-z0-9_-]{2,32}$/iu;
const kindValues: readonly FlairKind[] = [
  'user-templates', 'post-templates', 'user-assignments', 'user-assignment',
];
export const parseFlairRequest = (raw: Json): FlairRequest => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid flair request');
  const subreddit = raw['subreddit'];
  if (subreddit !== 'catgirlcoin' && subreddit !== 'nyaonearth') throw new Error('Unknown flair community');
  const kind = raw['kind'];
  if (typeof kind !== 'string' || !kindValues.includes(kind as FlairKind)) {
    throw new Error('Unknown flair read operation');
  }
  const username = raw['username'] ?? null;
  if (kind === 'user-assignment') return parseOneUser(subreddit, username, raw);
  if (username !== null || Object.keys(raw).some(key => key !== 'subreddit' && key !== 'kind')) {
    throw new Error('Unexpected flair read parameters');
  }
  return { subreddit, kind: kind as Exclude<FlairKind, 'user-assignment'>, username: null };
};
const parseOneUser = (
  subreddit: Community, username: Json, raw: Readonly<Record<string, Json>>,
): FlairRequest => {
  if (typeof username !== 'string' || !usernamePattern.test(username)) throw new Error('Invalid flair username');
  if (Object.keys(raw).some(key => key !== 'subreddit' && key !== 'kind' && key !== 'username')) {
    throw new Error('Unexpected user flair read parameter');
  }
  return { subreddit, kind: 'user-assignment', username };
};

export const projectFlairTemplate = (source: FlairTemplateSource): FlairTemplateWire => ({
  id: source.id,
  text: source.text,
  // Devvit does not expose legacy template css_class. Never invent it.
  cssClass: null,
  textColour: source.textColor,
  backgroundColour: source.backgroundColor,
  modOnly: source.modOnly,
  textEditable: source.allowUserEdits,
  allowableContent: source.allowableContent,
  maxEmojis: source.maxEmojis,
});
export const projectFlairAssignment = (source: FlairAssignmentSource): FlairAssignmentWire => {
  const username = source.user;
  if (username === undefined || !usernamePattern.test(username)) throw new Error('Flair listing omitted username');
  return {
    username,
    // Devvit's user flair listing exposes text and CSS class, but not template UUID.
    templateId: null,
    text: source.flairText ?? null,
    cssClass: source.flairCssClass ?? null,
  };
};
export const readFlairAssignments = async (reader: FlairAssignmentReader): Promise<readonly FlairAssignmentWire[]> => {
  const out: FlairAssignmentWire[] = [];
  const seenNames = new Set<string>();
  const cursors = new Set<string>();
  let after: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const result = await reader.getUserFlair({ limit: 1_000, ...(after === undefined ? {} : { after }) });
    if (result.users.length > 1_000) throw new Error('Reddit flair page exceeded maximum size');
    for (const source of result.users) {
      const record = projectFlairAssignment(source);
      const key = record.username.toLowerCase();
      if (seenNames.has(key)) throw new Error('Duplicate flair assignment in inventory');
      seenNames.add(key);
      out.push(record);
    }
    const next = result.next;
    if (next === undefined || next.length === 0) return out;
    if (result.users.length === 0 || cursors.has(next)) throw new Error('Reddit flair cursor stalled');
    cursors.add(next);
    after = next;
  }
  throw new Error('Reddit flair inventory exceeds safe pagination bound');
};
