import { parseMap, type Json } from '../types/json.ts';
import { arrVal, mapVal, numVal, strVal } from '../types/value.ts';
import type { RedditModerator, RedditRule } from './types.ts';
import type { RedditRelationshipUser } from './decode.ts';
import type { DevvitCommunity } from './devvitPostFeed.ts';

export type DevvitCommunityKind = 'moderators' | 'local-rules' | 'banned' | 'muted';

const rows = (body: string, subreddit: DevvitCommunity, kind: DevvitCommunityKind): readonly Json[] => {
  if (body.length > 131_072) throw new Error('Devvit community response exceeds safe maximum');
  const root = parseMap(body);
  if (root['protocol'] !== 1 || root['subreddit'] !== subreddit || root['kind'] !== kind) {
    throw new Error('Devvit community response mismatched protocol or installation');
  }
  const field = kind === 'moderators' ? 'moderators' : kind === 'local-rules' ? 'rules' : 'users';
  return arrVal(root[field], 'Devvit community rows');
};

export const parseDevvitModerators = (body: string, subreddit: DevvitCommunity): readonly RedditModerator[] => {
  const seen = new Set<string>();
  return rows(body, subreddit, 'moderators').map((value, index): RedditModerator => {
    const row = mapVal(value, 'Devvit moderator ' + index);
    const name = strVal(row['name'], 'moderator.name');
    const id = strVal(row['id'], 'moderator.id');
    if (!/^[a-z0-9_-]+$/iu.test(name) || !/^t2_[a-z0-9]+$/iu.test(id) ||
        seen.has(name.toLowerCase())) throw new Error('Invalid Devvit moderator identity');
    seen.add(name.toLowerCase());
    return {
      name,
      id,
      permissions: arrVal(row['permissions'], 'moderator.permissions')
        .map(value => strVal(value, 'moderator.permission')),
    };
  });
};

export const parseDevvitLocalRules = (body: string, subreddit: DevvitCommunity): readonly RedditRule[] =>
  rows(body, subreddit, 'local-rules').map((value, index): RedditRule => {
    const row = mapVal(value, 'Devvit local rule ' + index);
    const kind = strVal(row['kind'], 'rule.kind');
    if (kind !== 'all' && kind !== 'link' && kind !== 'comment') throw new Error('Invalid Devvit rule kind');
    const priority = numVal(row['priority'], 'rule.priority');
    if (!Number.isInteger(priority) || priority < 0) throw new Error('Invalid Devvit rule priority');
    return {
      shortName: strVal(row['shortName'], 'rule.shortName'),
      description: strVal(row['description'], 'rule.description'),
      violationReason: strVal(row['violationReason'], 'rule.violationReason'),
      kind,
      priority,
    };
  });

const relationship = (value: Json, index: number): RedditRelationshipUser => {
  const row = mapVal(value, 'Devvit relationship ' + index);
  const username = strVal(row['username'], 'relationship.username');
  if (!/^[a-z0-9_-]+$/iu.test(username)) throw new Error('Invalid Devvit relationship username');
  const date = numVal(row['date'], 'relationship.date');
  if (date < 0) throw new Error('Invalid Devvit relationship timestamp');
  const note = row['note'];
  if (note !== null && typeof note !== 'string') throw new Error('Invalid Devvit relationship note');
  return { username, note, date };
};
export const parseDevvitRelationships = (
  body: string,
  subreddit: DevvitCommunity,
  kind: 'banned' | 'muted',
): readonly RedditRelationshipUser[] => {
  const seen = new Set<string>();
  return rows(body, subreddit, kind).map((value, index): RedditRelationshipUser => {
    const item = relationship(value, index);
    if (seen.has(item.username.toLowerCase())) throw new Error('Duplicate Devvit relationship user');
    seen.add(item.username.toLowerCase());
    return item;
  });
};
export const parseDevvitSingleRelationship = (
  body: string,
  subreddit: DevvitCommunity,
  kind: 'banned-user' | 'muted-user',
  username: string,
): RedditRelationshipUser | null => {
  if (body.length > 16_384) throw new Error('Devvit relationship lookup response is too large');
  const data = parseMap(body);
  if (data['protocol'] !== 1 || data['subreddit'] !== subreddit || data['kind'] !== kind) {
    throw new Error('Devvit relationship lookup mismatched installation');
  }
  if (data['user'] === null) return null;
  const item = relationship(data['user'] ?? null, 0);
  if (item.username.toLowerCase() !== username.toLowerCase()) {
    throw new Error('Devvit relationship lookup returned the wrong user');
  }
  return item;
};
