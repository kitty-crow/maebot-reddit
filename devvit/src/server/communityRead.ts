import type { Community } from './postFeed.ts';

type Json = null | boolean | number | string | Json[] | { readonly [key: string]: Json };

export type CommunityReadKind = 'moderators' | 'local-rules' | 'banned' | 'muted' | 'banned-user' | 'muted-user';
export type CommunityReadRequest =
  | { readonly subreddit: Community; readonly kind: Exclude<CommunityReadKind, 'banned-user' | 'muted-user'> }
  | { readonly subreddit: Community; readonly kind: 'banned-user' | 'muted-user'; readonly username: string };

export type RelationshipSource = {
  readonly username: string;
  readonly date: Date;
  readonly note?: string | undefined;
};
export type RelationshipWire = {
  readonly username: string;
  readonly note: string | null;
  readonly date: number;
};
const relationshipDate = (source: RelationshipSource): number => {
  const millis = source.date.getTime();
  if (!Number.isFinite(millis)) throw new Error('Invalid Reddit relationship timestamp');
  return millis / 1000;
};
export const projectBannedUser = (source: RelationshipSource): RelationshipWire => ({
  username: source.username,
  note: source.note ?? null,
  date: relationshipDate(source),
});
export const projectMutedUser = (source: RelationshipSource): RelationshipWire => ({
  username: source.username,
  note: null,
  date: relationshipDate(source),
});

export type ModeratorSource = {
  readonly username: string;
  readonly id: string;
  readonly moderatorInfo: { readonly modPermissions: readonly string[] };
};
export type RuleSource = {
  readonly shortName: string;
  readonly description: string;
  readonly violationReason: string;
  readonly kind: 'all' | 'link' | 'comment';
  readonly priority: number;
};
export type ModeratorWire = {
  readonly name: string;
  readonly id: string;
  readonly permissions: readonly string[];
};
export type RuleWire = {
  readonly shortName: string;
  readonly description: string;
  readonly violationReason: string;
  readonly kind: string;
  readonly priority: number;
};

const usernamePattern = /^[a-z0-9_-]{2,32}$/iu;
export const parseSingleRelationship = (
  raw: Readonly<Record<string, Json>>, subreddit: Community,
  kind: 'banned-user' | 'muted-user',
): CommunityReadRequest => {
  const username = raw['username'];
  if (typeof username !== 'string' || !usernamePattern.test(username)) {
    throw new Error('Invalid relationship username');
  }
  if (Object.keys(raw).some(key => key !== 'subreddit' && key !== 'kind' && key !== 'username')) {
    throw new Error('Unexpected single relationship request field');
  }
  return { subreddit, kind, username };
};

export const selectRelationship = <T extends { readonly username: string }>(
  matches: readonly T[], username: string,
): T | null => {
  const found = matches.filter(item => item.username.toLowerCase() === username.toLowerCase());
  if (found.length > 1) throw new Error('Duplicate relationship user returned');
  return found[0] ?? null;
};

export const parseCommunityRequest = (raw: Json): CommunityReadRequest => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Expected an object');
  const subreddit = raw['subreddit'];
  const kind = raw['kind'];
  if (subreddit !== 'catgirlcoin' && subreddit !== 'nyaonearth') throw new Error('Unknown community');
  if (kind === 'banned-user' || kind === 'muted-user') {
    return parseSingleRelationship(raw, subreddit, kind);
  }
  if (kind !== 'moderators' && kind !== 'local-rules' && kind !== 'banned' && kind !== 'muted') {
    throw new Error('Unknown community read');
  }
  if (Object.keys(raw).some(key => key !== 'subreddit' && key !== 'kind')) {
    throw new Error('Unexpected community read field');
  }
  return { subreddit, kind };
};

export const projectModerator = (source: ModeratorSource): ModeratorWire => ({
  name: source.username,
  id: source.id,
  permissions: [...source.moderatorInfo.modPermissions],
});

export const projectRule = (source: RuleSource): RuleWire => ({
  shortName: source.shortName,
  description: source.description,
  violationReason: source.violationReason,
  kind: source.kind,
  priority: source.priority,
});
