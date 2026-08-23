import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { redditConfig } from '../src/env.ts';
import { RedditReadClient } from '../src/reddit/client.ts';
import type { RedditFlairAssignment, RedditFlairTemplate } from '../src/reddit/types.ts';
import {
  TIER_FLAIRS,
  chooseTierOneFlair,
  moderationStatus,
  tierFlair,
  tierForPoints,
} from '../src/reputation/policy.ts';
import {
  ReputationStore,
  type ReputationBootstrap,
  type ReputationSeedSource,
  type ReputationUser,
} from '../src/reputation/store.ts';
import { safeError } from '../src/reddit/error.ts';

const cfg = redditConfig();
const flag = (name: string): boolean => process.argv.includes(name);
const valueArg = (prefix: string): string | null => {
  const value = process.argv.find(arg => arg.startsWith(`${prefix}=`));
  return value === undefined ? null : value.slice(prefix.length + 1).trim();
};

const subreddit = (valueArg('--subreddit') ?? cfg.sourceSubreddit).replace(/^r\//iu, '');
const force = flag('--force');
const reportPath = resolve(process.cwd(), valueArg('--report') ?? 'data/reputation-bootstrap-report.json');
const statePath = resolve(process.cwd(), valueArg('--state') ?? 'data/reputation.pb');
const now = Math.floor(Date.now() / 1_000);
const client = new RedditReadClient(cfg.auth);

const lower = (value: string): string => value.trim().toLowerCase();
const assignmentKey = (value: RedditFlairAssignment): string => lower(value.username);

const exactTemplate = (templates: readonly RedditFlairTemplate[], text: string): RedditFlairTemplate => {
  const matches = templates.filter(template => template.text.trim().toLowerCase() === text.toLowerCase());
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one user flair ${JSON.stringify(text)} in r/${subreddit}; found ${matches.length}`);
  }
  const match = matches[0];
  if (match === undefined) throw new Error(`Flair ${JSON.stringify(text)} disappeared during inventory`);
  return match;
};

const reportTemplate = (template: RedditFlairTemplate): Record<string, unknown> => ({
  id: template.id,
  text: template.text,
  cssClass: template.cssClass,
  modOnly: template.modOnly,
  textEditable: template.textEditable,
  textColour: template.textColour,
  backgroundColour: template.backgroundColour,
});

const user = (
  assignment: RedditFlairAssignment,
  moderators: ReadonlySet<string>,
  banned: ReadonlySet<string>,
): ReputationUser => {
  const username = assignment.username;
  const key = lower(username);
  const immutableModeratorFlair = moderators.has(key);

  if (immutableModeratorFlair) {
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
      seededAt: now,
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
      seededAt: now,
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
      seededAt: now,
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
      seededAt: now,
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
    seededAt: now,
  };
};

try {
  const [userFlairs, postFlairs, assignments, moderatorRows, bannedRows, recentPosts, recentComments] = await Promise.all([
    client.userFlairTemplates(subreddit),
    client.postFlairTemplates(subreddit),
    client.userFlairAssignments(subreddit),
    client.moderators(subreddit),
    client.bannedUsers(subreddit),
    client.newPosts(subreddit, 100),
    client.newComments(subreddit, 100),
  ]);

  console.log(`=== r/${subreddit} USER FLAIRS (${userFlairs.length}) ===`);
  for (const template of userFlairs) {
    console.log(`${template.id}\t${JSON.stringify(template.text)}\tcss=${template.cssClass ?? '-'}\tmodOnly=${template.modOnly}`);
  }
  console.log(`\n=== r/${subreddit} POST FLAIRS (${postFlairs.length}) ===`);
  for (const template of postFlairs) {
    console.log(`${template.id}\t${JSON.stringify(template.text)}\tcss=${template.cssClass ?? '-'}\tmodOnly=${template.modOnly}`);
  }

  const tierTemplates = new Map<string, RedditFlairTemplate>();
  for (const definition of TIER_FLAIRS) tierTemplates.set(definition.text, exactTemplate(userFlairs, definition.text));

  const moderators = new Set(moderatorRows.map(row => lower(row.name)));
  const banned = new Set(bannedRows.map(row => lower(row.username)));
  const assignmentByUser = new Map(assignments.map(value => [assignmentKey(value), value]));
  const users = new Map<string, ReputationUser>();

  for (const assignment of assignments) users.set(assignmentKey(assignment), user(assignment, moderators, banned));

  for (const row of moderatorRows) {
    const key = lower(row.name);
    if (users.has(key)) continue;
    users.set(key, {
      username: row.name,
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
      seededAt: now,
    });
  }

  for (const row of bannedRows) {
    const key = lower(row.username);
    if (users.has(key)) continue;
    users.set(key, {
      username: row.username,
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
      seededAt: now,
    });
  }

  const recentContributors = new Map<string, string>();
  for (const item of [...recentPosts, ...recentComments]) {
    if (item.author === null) continue;
    recentContributors.set(lower(item.author), item.author);
  }

  let recentContributorsWithoutFlair = 0;
  for (const [key, username] of recentContributors) {
    if (assignmentByUser.has(key) || users.has(key)) continue;
    recentContributorsWithoutFlair += 1;
    if (moderators.has(key)) {
      users.set(key, {
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
        seededAt: now,
      });
      continue;
    }

    const desiredText = chooseTierOneFlair();
    const desired = tierTemplates.get(desiredText);
    if (desired === undefined) throw new Error(`Tier-one flair ${desiredText} is missing from resolved inventory`);
    users.set(key, {
      username,
      points: 1,
      tier: tierForPoints(1),
      status: 'ordinary',
      currentFlairTemplateId: null,
      currentFlairText: null,
      currentFlairCssClass: null,
      desiredFlairTemplateId: desired.id,
      desiredFlairText: desired.text,
      immutableModeratorFlair: false,
      needsFlair: true,
      needsReview: false,
      source: 'recent-unflaired-contributor',
      seededAt: now,
    });
  }

  const coverageNote = 'Reddit does not expose a complete subscriber/member roster. Flaired users are complete from /api/flairlist; unflair users are discoverable only when they appear in accessible contribution listings. This bootstrap records unflair authors seen in the latest 100 posts and latest 100 comments and future runtime ingestion must add unseen contributors on first contribution.';
  const bootstrap: ReputationBootstrap = {
    subreddit,
    at: now,
    userFlairTemplates: userFlairs,
    postFlairTemplates: postFlairs,
    users: [...users.values()].sort((a, b) => a.username.localeCompare(b.username)),
    coverage: {
      flairAssignments: assignments.length,
      moderators: moderatorRows.length,
      bannedUsers: bannedRows.length,
      recentPostsScanned: recentPosts.length,
      recentCommentsScanned: recentComments.length,
      recentContributorsWithoutFlair,
      note: coverageNote,
    },
  };

  const store = new ReputationStore(statePath);
  await store.bootstrap(bootstrap, force);

  const byTier = new Map<number, number>();
  const byStatus = new Map<string, number>();
  let needsFlair = 0;
  let needsReview = 0;
  for (const value of bootstrap.users) {
    byTier.set(value.tier, (byTier.get(value.tier) ?? 0) + 1);
    byStatus.set(value.status, (byStatus.get(value.status) ?? 0) + 1);
    if (value.needsFlair) needsFlair += 1;
    if (value.needsReview) needsReview += 1;
  }

  const report = {
    generatedAt: new Date(now * 1_000).toISOString(),
    subreddit,
    statePath,
    coverage: bootstrap.coverage,
    tierFlairReferences: Object.fromEntries(
      TIER_FLAIRS.map(definition => {
        const template = tierTemplates.get(definition.text);
        return [definition.text, { tier: definition.tier, seedPoints: definition.seedPoints, templateId: template?.id ?? null }];
      }),
    ),
    userFlairs: userFlairs.map(reportTemplate),
    postFlairs: postFlairs.map(reportTemplate),
    summary: {
      usersPersisted: bootstrap.users.length,
      byTier: Object.fromEntries([...byTier.entries()].sort((a, b) => a[0] - b[0])),
      byStatus: Object.fromEntries([...byStatus.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
      needsFlair,
      needsReview,
    },
    users: bootstrap.users,
  };

  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');

  console.log('\n=== REPUTATION BOOTSTRAP ===');
  console.log(`protobuf: ${statePath}`);
  console.log(`report:   ${reportPath}`);
  console.log(`users persisted: ${bootstrap.users.length}`);
  console.log(`tier 0: ${byTier.get(0) ?? 0}`);
  console.log(`tier 1: ${byTier.get(1) ?? 0}`);
  console.log(`tier 2: ${byTier.get(2) ?? 0}`);
  console.log(`tier 3: ${byTier.get(3) ?? 0}`);
  console.log(`tier 4: ${byTier.get(4) ?? 0}`);
  console.log(`recent contributors missing flair: ${recentContributorsWithoutFlair}`);
  console.log(`records requiring manual semantic review: ${needsReview}`);
  console.log(`records requiring a tier flair application: ${needsFlair}`);
  console.log(`NOTE: ${coverageNote}`);
} catch (error) {
  console.error(`Reputation bootstrap failed: ${safeError(error)}`);
  process.exitCode = 1;
}
