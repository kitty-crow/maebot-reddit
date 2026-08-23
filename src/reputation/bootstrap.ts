import { createHash } from 'node:crypto';
import type { RedditRelationshipUser } from '../reddit/decode.ts';
import type {
  RedditComment,
  RedditFlairAssignment,
  RedditFlairTemplate,
  RedditModerator,
  RedditPost,
} from '../reddit/types.ts';
import {
  TIER_FLAIRS,
  chooseTierOneFlair,
  moderationStatus,
  tierFlair,
  tierForPoints,
} from './policy.ts';
import type {
  ReputationBootstrap,
  ReputationFlairReferences,
  ReputationSeedSource,
  ReputationUser,
} from './store.ts';

export type ReputationInventory = {
  readonly subreddit: string;
  readonly at: number;
  readonly userFlairs: readonly RedditFlairTemplate[];
  readonly postFlairs: readonly RedditFlairTemplate[];
  readonly assignments: readonly RedditFlairAssignment[];
  readonly moderators: readonly RedditModerator[];
  readonly bannedUsers: readonly RedditRelationshipUser[];
  readonly posts: readonly RedditPost[];
  readonly comments: readonly RedditComment[];
};

export type ReputationBootstrapPlan = {
  readonly bootstrap: ReputationBootstrap;
  readonly recentContributorsWithoutFlair: number;
};

const lower = (value: string): string => value.trim().toLowerCase();

const exactTemplate = (
  subreddit: string,
  templates: readonly RedditFlairTemplate[],
  text: string,
  required: boolean,
): RedditFlairTemplate | null => {
  const matches = templates.filter(template => lower(template.text) === lower(text));
  if (matches.length > 1 || (required && matches.length !== 1)) {
    throw new Error(`Expected ${required ? 'exactly one' : 'at most one'} flair ${JSON.stringify(text)} in r/${subreddit}; found ${matches.length}`);
  }
  return matches[0] ?? null;
};

const tierReferences = (
  subreddit: string,
  userFlairs: readonly RedditFlairTemplate[],
): ReadonlyMap<string, RedditFlairTemplate> => {
  const out = new Map<string, RedditFlairTemplate>();
  for (const definition of TIER_FLAIRS) {
    const template = exactTemplate(subreddit, userFlairs, definition.text, true);
    if (template === null) throw new Error(`Required tier flair ${definition.text} was not resolved`);
    out.set(definition.text, template);
  }
  return out;
};

const tierTemplate = (templates: ReadonlyMap<string, RedditFlairTemplate>, text: string): RedditFlairTemplate => {
  const value = templates.get(text);
  if (value === undefined) throw new Error(`Tier flair ${text} was not resolved`);
  return value;
};

export const resolveFlairReferences = (
  subreddit: string,
  userFlairs: readonly RedditFlairTemplate[],
  postFlairs: readonly RedditFlairTemplate[],
): ReputationFlairReferences => {
  const tiers = tierReferences(subreddit, userFlairs);
  return {
    user: {
      mae: tierTemplate(tiers, ':mae:').id,
      lisa: tierTemplate(tiers, ':lisa:').id,
      kita: tierTemplate(tiers, ':kita:').id,
      aoi: tierTemplate(tiers, ':aoi:').id,
      hana: tierTemplate(tiers, ':hana:').id,
      rin: tierTemplate(tiers, ':rin:').id,
      celeste: tierTemplate(tiers, ':celeste:').id,
      warned: exactTemplate(subreddit, userFlairs, 'Warned', false)?.id ?? null,
      uncivil: exactTemplate(subreddit, userFlairs, 'Uncivil', false)?.id ?? null,
      scam: exactTemplate(subreddit, userFlairs, 'SCAM', false)?.id ?? null,
    },
    post: {
      minorAnnouncement: exactTemplate(subreddit, postFlairs, 'Minor Announcement :lisa:', false)?.id ?? null,
      announcement: exactTemplate(subreddit, postFlairs, 'Announcement :catgirl-moon:', false)?.id ?? null,
    },
  };
};

const deterministicTierOneRoll = (subreddit: string, username: string): number => {
  const digest = createHash('sha256')
    .update('mae-reputation-bootstrap-tier-one\0')
    .update(lower(subreddit))
    .update('\0')
    .update(lower(username))
    .digest();
  return digest.readUIntBE(0, 6) / 281_474_976_710_656;
};

const assignmentUser = (
  assignment: RedditFlairAssignment,
  at: number,
  moderators: ReadonlySet<string>,
  banned: ReadonlySet<string>,
): ReputationUser => {
  const username = assignment.username;
  const key = lower(username);

  if (moderators.has(key)) {
    return {
      username,
      points: 0,
      tier: 0,
      status: 'moderator',
      currentFlairTemplateId: assignment.templateId,
      currentFlairText: assignment.text,
      currentFlairCssClass: assignment.cssClass,
      desiredFlairTemplateId: assignment.templateId,
      desiredFlairText: assignment.text,
      immutableModeratorFlair: true,
      needsFlair: false,
      needsReview: false,
      source: 'moderator',
      seededAt: at,
    };
  }

  const status = moderationStatus(assignment, banned.has(key));
  if (status !== null) {
    const source: ReputationSeedSource = banned.has(key) && status.status === 'banned' ? 'reddit-ban' : 'status-flair';
    return {
      username,
      points: status.points,
      tier: 0,
      status: status.status,
      currentFlairTemplateId: assignment.templateId,
      currentFlairText: assignment.text,
      currentFlairCssClass: assignment.cssClass,
      desiredFlairTemplateId: assignment.templateId,
      desiredFlairText: assignment.text,
      immutableModeratorFlair: false,
      needsFlair: false,
      needsReview: false,
      source,
      seededAt: at,
    };
  }

  const tier = tierFlair(assignment);
  if (tier !== null) {
    return {
      username,
      points: tier.seedPoints,
      tier: tier.tier,
      status: 'ordinary',
      currentFlairTemplateId: assignment.templateId,
      currentFlairText: assignment.text,
      currentFlairCssClass: assignment.cssClass,
      desiredFlairTemplateId: assignment.templateId,
      desiredFlairText: assignment.text,
      immutableModeratorFlair: false,
      needsFlair: false,
      needsReview: false,
      source: 'tier-flair',
      seededAt: at,
    };
  }

  if (banned.has(key)) {
    return {
      username,
      points: -3,
      tier: 0,
      status: 'banned',
      currentFlairTemplateId: assignment.templateId,
      currentFlairText: assignment.text,
      currentFlairCssClass: assignment.cssClass,
      desiredFlairTemplateId: assignment.templateId,
      desiredFlairText: assignment.text,
      immutableModeratorFlair: false,
      needsFlair: false,
      needsReview: true,
      source: 'reddit-ban',
      seededAt: at,
    };
  }

  return {
    username,
    points: 0,
    tier: 0,
    status: 'unmapped',
    currentFlairTemplateId: assignment.templateId,
    currentFlairText: assignment.text,
    currentFlairCssClass: assignment.cssClass,
    desiredFlairTemplateId: assignment.templateId,
    desiredFlairText: assignment.text,
    immutableModeratorFlair: false,
    needsFlair: false,
    needsReview: true,
    source: 'unmapped-flair',
    seededAt: at,
  };
};

const moderatorUser = (username: string, at: number): ReputationUser => ({
  username,
  points: 0,
  tier: 0,
  status: 'moderator',
  currentFlairTemplateId: null,
  currentFlairText: null,
  currentFlairCssClass: null,
  desiredFlairTemplateId: null,
  desiredFlairText: null,
  immutableModeratorFlair: true,
  needsFlair: false,
  needsReview: false,
  source: 'moderator',
  seededAt: at,
});

const bannedUser = (username: string, at: number): ReputationUser => ({
  username,
  points: -3,
  tier: 0,
  status: 'banned',
  currentFlairTemplateId: null,
  currentFlairText: null,
  currentFlairCssClass: null,
  desiredFlairTemplateId: null,
  desiredFlairText: null,
  immutableModeratorFlair: false,
  needsFlair: false,
  needsReview: false,
  source: 'reddit-ban',
  seededAt: at,
});

const firstContributionUser = (
  subreddit: string,
  username: string,
  at: number,
  references: ReputationFlairReferences,
): ReputationUser => {
  const desiredText = chooseTierOneFlair(() => deterministicTierOneRoll(subreddit, username));
  const desiredFlairTemplateId = desiredText === ':lisa:' ? references.user.lisa : references.user.mae;
  return {
    username,
    points: 1,
    tier: tierForPoints(1),
    status: 'ordinary',
    currentFlairTemplateId: null,
    currentFlairText: null,
    currentFlairCssClass: null,
    desiredFlairTemplateId,
    desiredFlairText: desiredText,
    immutableModeratorFlair: false,
    needsFlair: true,
    needsReview: false,
    source: 'recent-unflaired-contributor',
    seededAt: at,
  };
};

export const planReputationBootstrap = (inventory: ReputationInventory): ReputationBootstrapPlan => {
  const references = resolveFlairReferences(inventory.subreddit, inventory.userFlairs, inventory.postFlairs);
  const moderators = new Set(inventory.moderators.map(row => lower(row.name)));
  const banned = new Set(inventory.bannedUsers.map(row => lower(row.username)));
  const assignments = new Map<string, RedditFlairAssignment>();
  for (const assignment of inventory.assignments) {
    const key = lower(assignment.username);
    if (assignments.has(key)) throw new Error(`Duplicate flair assignment returned for u/${assignment.username}`);
    assignments.set(key, assignment);
  }

  const users = new Map<string, ReputationUser>();
  for (const assignment of inventory.assignments) {
    users.set(lower(assignment.username), assignmentUser(assignment, inventory.at, moderators, banned));
  }

  for (const row of inventory.moderators) {
    const key = lower(row.name);
    if (!users.has(key)) users.set(key, moderatorUser(row.name, inventory.at));
  }

  for (const row of inventory.bannedUsers) {
    const key = lower(row.username);
    if (!users.has(key)) users.set(key, bannedUser(row.username, inventory.at));
  }

  const contributors = new Map<string, string>();
  for (const item of [...inventory.posts, ...inventory.comments]) {
    if (item.author !== null) contributors.set(lower(item.author), item.author);
  }

  let recentContributorsWithoutFlair = 0;
  for (const [key, username] of contributors) {
    if (assignments.has(key) || users.has(key)) continue;
    recentContributorsWithoutFlair += 1;
    if (moderators.has(key)) users.set(key, moderatorUser(username, inventory.at));
    else users.set(key, firstContributionUser(inventory.subreddit, username, inventory.at, references));
  }

  const coverageNote = 'Reddit does not expose a complete subscriber/member roster. Flaired users are complete from /api/flairlist; unflair users are discoverable only when they appear in accessible contribution listings. This bootstrap records unflair authors found across the maximum accessible /new and /comments listing history (up to 1000 of each) and future runtime ingestion must add unseen contributors on first contribution.';

  return {
    recentContributorsWithoutFlair,
    bootstrap: {
      subreddit: inventory.subreddit,
      at: inventory.at,
      userFlairTemplates: inventory.userFlairs,
      postFlairTemplates: inventory.postFlairs,
      flairReferences: references,
      users: [...users.values()].sort((a, b) => a.username.localeCompare(b.username)),
      coverage: {
        flairAssignments: inventory.assignments.length,
        moderators: inventory.moderators.length,
        bannedUsers: inventory.bannedUsers.length,
        recentPostsScanned: inventory.posts.length,
        recentCommentsScanned: inventory.comments.length,
        recentContributorsWithoutFlair,
        note: coverageNote,
      },
    },
  };
};
