import type { Community } from './postFeed.ts';

type Json = null | boolean | number | string | Json[] | { readonly [key: string]: Json };

export type CommunityReadKind = 'moderators' | 'local-rules';
export type CommunityReadRequest = {
  readonly subreddit: Community;
  readonly kind: CommunityReadKind;
};

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

export const parseCommunityRequest = (raw: Json): CommunityReadRequest => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Expected an object');
  const subreddit = raw['subreddit'];
  const kind = raw['kind'];
  if (subreddit !== 'catgirlcoin' && subreddit !== 'nyaonearth') throw new Error('Unknown community');
  if (kind !== 'moderators' && kind !== 'local-rules') throw new Error('Unknown community read');
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
