import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { redditConfig } from '../src/env.ts';
import { RedditReadClient } from '../src/reddit/client.ts';
import type { RedditFlairAssignment, RedditFlairTemplate } from '../src/reddit/types.ts';
import type { JsonMap } from '../src/types/json.ts';
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
  type ReputationFlairReferences,
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

const optionalTemplate = (templates: readonly RedditFlairTemplate[], text: string): RedditFlairTemplate | null => {
  const matches = templates.filter(template => template.text.trim().toLowerCase() === text.toLowerCase());
  if (matches.length > 1) throw new Error(`Flair ${JSON.stringify(text)} is ambiguous in r/${subreddit}`);
  return matches[0] ?? null;
};

const reportTemplate = (template: RedditFlairTemplate): JsonMap => ({
  id: template.id,
  text: template.text,
  cssClass: template.cssClass,
  modOnly: template.modOnly,
  textEditable: template.textEditable,
  textColour: template.textColour,
  backgroundColour: template.backgroundColour,
});

const bootstrapRoll = (username: string): number => {
  const digest = createHash('sha256')
    .update('mae-reputation-bootstrap-tier-one\0')
    .update(subreddit.toLowerCase())
    .update('\0')
    .update(lower(username))
    .digest();
  return digest.readUIntBE(0, 6) / 281_474_976_710_656;
};

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
    client.newPostsHistory(subreddit, 1000),
    client.newCommentsHistory(subreddit, 1000),
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
  const tierTemplate = (text: string): RedditFlairTemplate => {
    const value = tierTemplates.get(text);
    if (value === undefined) throw new Error(`Tier flair ${text} was not resolved`);
    return value;
  };

  const flairReferences: ReputationFlairReferences = {
    user: {
      mae: tierTemplate(':mae:').id,
      lisa: tierTemplate(':lisa:').id,
      kita: tierTemplate(':kita:').id,
      aoi: tierTemplate(':aoi:').id,
      hana: tierTemplate(':hana:').id,
      rin: tierTemplate(':rin:').id,
      celeste: tierTemplate(':celeste:').id,
      warned: optionalTemplate(userFlairs, 'Warned')?.id ?? null,
      uncivil: optionalTemplate(userFlairs, 'Uncivil')?.id ?? null,
      scam: optionalTemplate(userFlairs, 'SCAM')?.id ?? null,
    },
    post: {
      minorAnnouncement: optionalTemplate(postFlairs, 'Minor Announcement :lisa:')?.id ?? null,
      announcement: optionalTemplate(postFlairs, 'Announcement :catgirl-moon:')?.id ?? null,
    },
  };

  const moderators = new Set(moderatorRows.map(row => lower(row.name)));
  const banned = new Set(bannedRows.map(row => lower(row.username)));
  const assignmentByUser = new Map<string, RedditFlairAssignment>();
  for (const assignment of assignments) {
    const key = assignmentKey(assignment);
    if (assignmentByUser.has(key)) throw new Error(`Duplicate flair assignment returned for u/${assignment.username}`);
    assignmentByUser.set(key, assignment);
  }
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

    const desiredText = chooseTierOneFlair(() => bootstrapRoll(username));
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

  const coverageNote = 'Reddit does not expose a complete subscriber/member roster. Flaired users are complete from /api/flairlist; unflair users are discoverable only when they appear in accessible contribution listings. This bootstrap records unflair authors found across the maximum accessible /new and /comments listing history (up to 1000 of each) and future runtime ingestion must add unseen contributors on first contribution.';
  const bootstrap: ReputationBootstrap = {
    subreddit,
    at: now,
    userFlairTemplates: userFlairs,
    postFlairTemplates: postFlairs,
    flairReferences,
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
    flairReferences,
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

  const store = new ReputationStore(statePath);
  await store.bootstrap(bootstrap, force);
  if (!(await store.hasBootstrap())) throw new Error('Reputation protobuf did not verify after bootstrap');

  console.log('\n=== SEMANTIC FLAIR REFERENCES ===');
  console.log(`user :mae:                    ${flairReferences.user.mae}`);
  console.log(`user :lisa:                   ${flairReferences.user.lisa}`);
  console.log(`user :kita:                   ${flairReferences.user.kita}`);
  console.log(`user :aoi:                    ${flairReferences.user.aoi}`);
  console.log(`user :hana:                   ${flairReferences.user.hana}`);
  console.log(`user :rin:                    ${flairReferences.user.rin}`);
  console.log(`user :celeste:                ${flairReferences.user.celeste}`);
  console.log(`user Warned                   ${flairReferences.user.warned ?? 'NOT RESOLVED'}`);
  console.log(`user Uncivil                  ${flairReferences.user.uncivil ?? 'NOT RESOLVED'}`);
  console.log(`user SCAM                     ${flairReferences.user.scam ?? 'NOT RESOLVED'}`);
  console.log(`post Minor Announcement :lisa: ${flairReferences.post.minorAnnouncement ?? 'NOT RESOLVED'}`);
  console.log(`post Announcement :catgirl-moon: ${flairReferences.post.announcement ?? 'NOT RESOLVED'}`);

  console.log('\n=== REPUTATION BOOTSTRAP ===');
  console.log(`protobuf: ${statePath}`);
  console.log(`report:   ${reportPath}`);
  console.log(`users persisted: ${bootstrap.users.length}`);
  console.log(`tier 0: ${byTier.get(0) ?? 0}`);
  console.log(`tier 1: ${byTier.get(1) ?? 0}`);
  console.log(`tier 2: ${byTier.get(2) ?? 0}`);
  console.log(`tier 3: ${byTier.get(3) ?? 0}`);
  console.log(`tier 4: ${byTier.get(4) ?? 0}`);
  console.log(`unflaired contributors found in accessible history: ${recentContributorsWithoutFlair}`);
  console.log(`records requiring manual semantic review: ${needsReview}`);
  console.log(`records requiring a tier flair application: ${needsFlair}`);
  console.log(`NOTE: ${coverageNote}`);

  const reviewUsers = bootstrap.users.filter(value => value.needsReview);
  if (reviewUsers.length > 0) {
    console.log('\n=== USERS REQUIRING REVIEW ===');
    for (const value of reviewUsers) {
      console.log(`u/${value.username}\tflair=${JSON.stringify(value.currentFlairText)}\tcss=${value.currentFlairCssClass ?? '-'}\tsource=${value.source}`);
    }
  }

  const flairUsers = bootstrap.users.filter(value => value.needsFlair);
  if (flairUsers.length > 0) {
    console.log('\n=== DISCOVERED USERS WITHOUT FLAIR ===');
    for (const value of flairUsers) {
      console.log(`u/${value.username}\tpoints=${value.points}\tdesired=${value.desiredFlairText}\ttemplate=${value.desiredFlairTemplateId}`);
    }
  }
} catch (error) {
  console.error(`Reputation bootstrap failed: ${safeError(error)}`);
  process.exitCode = 1;
}
