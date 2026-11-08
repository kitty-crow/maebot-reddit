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

export const parseDevvitRelationships = (
  body: string,
  subreddit: DevvitCommunity,
  kind: 'banned' | 'muted',
): readonly RedditRelationshipUser[] => {
  const seen = new Set<string>();
  return rows(body, subreddit, kind).map((value, index): RedditRelationshipUser => {
    const row = mapVal(value, 'Devvit relationship ' + index);
    const username = strVal(row['username'], 'relationship.username');
    if (!/^[a-z0-9_-]+$/iu.test(username) || seen.has(username.toLowerCase())) {
      throw new Error('Invalid or duplicate Devvit relationship username');
    }
    seen.add(username.toLowerCase());
    const date = numVal(row['date'], 'relationship.date');
    if (date < 0) throw new Error('Invalid Devvit relationship timestamp');
    const note = row['note'];
    if (note !== null && typeof note !== 'string') throw new Error('Invalid Devvit relationship note');
    return { username, note, date };
  });
};
