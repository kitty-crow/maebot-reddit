import 'dotenv/config';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { redditConfig, redditModerationConfig } from '../src/env.ts';
import { FlairCloner } from '../src/flair/clone.ts';
import { cloneStickyPosts } from '../src/migration/stickyClone.ts';
import { mirrorKey, PostMirrorStore } from '../src/mirror/store.ts';
import { communityFlairRestores } from '../src/reputation/communityProjection.ts';
import { CommunityProjectionStore } from '../src/reputation/communityProjectionStore.ts';
import { redditMuteAction } from '../src/reputation/mutePolicy.ts';
import { ReputationStore } from '../src/reputation/store.ts';
import { reputationUsersRequiringReview } from '../src/reputation/trackingRepair.ts';
import { RedditReadClient } from '../src/reddit/client.ts';
import { RedditMutationClient } from '../src/reddit/mutate.ts';
import type { RedditFlairTemplate, RedditModerator } from '../src/reddit/types.ts';
import { isMap, parseMap } from '../src/types/json.ts';

const sourceSubreddit = 'catgirlcoin';
const targetSubreddit = 'nyaonearth';

const cfg = redditConfig();
const moderationCfg = redditModerationConfig();
if (moderationCfg === null) throw new Error('REDDIT_MODERATION_ENABLED must be true for community bootstrap');
if (cfg.sourceSubreddit.toLowerCase() !== sourceSubreddit) {
  throw new Error('Community bootstrap requires REDDIT_SOURCE_SUBREDDIT=catgirlcoin');
}
const primary = cfg.primarySubreddit.toLowerCase();
if (primary !== sourceSubreddit && primary !== targetSubreddit) {
  throw new Error('REDDIT_PRIMARY_SUBREDDIT must be catgirlcoin before bootstrap or nyaonearth after cutover');
}

const read = new RedditReadClient(cfg.auth);
const write = new RedditMutationClient(cfg.auth);
const reputation = new ReputationStore(moderationCfg.stateFile);
const projection = new CommunityProjectionStore(resolve(
  process.cwd(),
  process.env['REDDIT_COMMUNITY_PROJECTION_STATE_FILE']?.trim() || 'data/communityProjection.pb',
));
const mirror = new PostMirrorStore(resolve(
  process.cwd(),
  process.env['REDDIT_MIRROR_STATE_FILE']?.trim() || 'data/postMirror.pb',
));
if (!(await reputation.hasBootstrap())) {
  throw new Error(`Canonical reputation store is not bootstrapped at ${moderationCfg.stateFile}`);
}

const [
  me,
  source,
  target,
  sourceModerators,
  targetModerators,
  sourceBans,
  targetBansBefore,
  targetMutedBefore,
  reputationRaw,
] = await Promise.all([
  read.me(),
  read.subreddit(sourceSubreddit),
  read.subreddit(targetSubreddit),
  read.moderators(sourceSubreddit),
  read.moderators(targetSubreddit),
  read.bannedUsers(sourceSubreddit),
  read.bannedUsers(targetSubreddit),
  read.mutedUsers(targetSubreddit),
  reputation.raw(),
]);
if (!source.userIsModerator) throw new Error(`${me.name} is not a moderator of r/${sourceSubreddit}`);
if (!target.userIsModerator) throw new Error(`${me.name} is not a moderator of r/${targetSubreddit}`);
if (!isMap(reputationRaw) || !isMap(reputationRaw['users'])) {
  throw new Error('Canonical reputation users map is missing');
}

const requiredPermissions = ['access', 'flair', 'posts', 'mail'] as const;
const assertPermissions = (
  subreddit: string,
  moderators: readonly RedditModerator[],
): void => {
  const mae = moderators.find(row => row.name.toLowerCase() === me.name.toLowerCase());
  if (mae === undefined) throw new Error(`${me.name} is absent from r/${subreddit} moderator inventory`);
  const granted = new Set(mae.permissions.map(value => value.toLowerCase()));
  if (granted.has('all')) return;
  const missing = requiredPermissions.filter(permission => !granted.has(permission));
  if (missing.length > 0) {
    throw new Error(`r/${subreddit} is missing Mae moderator permissions required for bootstrap: ${missing.join(', ')}`);
  }
};
assertPermissions(sourceSubreddit, sourceModerators);
assertPermissions(targetSubreddit, targetModerators);

const canonicalBans = new Map<string, string>();
for (const [key, raw] of Object.entries(reputationRaw['users'])) {
  if (!isMap(raw)) continue;
  const username = typeof raw['username'] === 'string' && raw['username'].trim().length > 0
    ? raw['username']
    : key;
  if (raw['status'] === 'banned' || raw['status'] === 'scam') canonicalBans.set(username.toLowerCase(), username);
}
const unresolvedUsers = reputationUsersRequiringReview(reputationRaw);
if (unresolvedUsers.length > 0) {
  throw new Error(
    `Community bootstrap refused: canonical reputation still has users requiring semantic review: ${unresolvedUsers.join(', ')}`,
  );
}

const sourceBanKeys = new Set(sourceBans.map(item => item.username.toLowerCase()));
const canonicalBanKeys = new Set(canonicalBans.keys());
const sourceMissingFromCanonical = [...sourceBanKeys].filter(key => !canonicalBanKeys.has(key));
const canonicalMissingFromSource = [...canonicalBanKeys].filter(key => !sourceBanKeys.has(key));
if (sourceMissingFromCanonical.length > 0 || canonicalMissingFromSource.length > 0) {
  throw new Error(
    `Community bootstrap refused: r/${sourceSubreddit} bans and canonical reputation differ. `
    + `source-only=${sourceMissingFromCanonical.join(', ') || '(none)'}; `
    + `canonical-only=${canonicalMissingFromSource.join(', ') || '(none)'}`,
  );
}

const targetBanKeysBefore = new Set(targetBansBefore.map(item => item.username.toLowerCase()));
const targetExtraBans = [...targetBanKeysBefore].filter(key => !canonicalBanKeys.has(key));
if (targetExtraBans.length > 0) {
  throw new Error(
    `Community bootstrap refused: r/${targetSubreddit} has bans absent from canonical reputation: ${targetExtraBans.join(', ')}`,
  );
}

// The running dual-community Mae must already have established communication
// protection in NyaOnEarth before this command may expose the mass ban. Require
// both Mae's durable projection checkpoint and Reddit's live muted relationship;
// either one alone can be stale or manually altered.
const now = Date.now();
const targetMuteKeysBefore = new Set(targetMutedBefore.map(item => item.username.toLowerCase()));
const unprotectedPermanentUsers: string[] = [];
for (const username of canonicalBans.values()) {
  const key = username.toLowerCase();
  const current = await projection.muteState(targetSubreddit, username);
  const checkpointReady = redditMuteAction({ muteUntil: null, permanent: true }, current, now) === null;
  if (!checkpointReady || !targetMuteKeysBefore.has(key)) unprotectedPermanentUsers.push(username);
}
if (unprotectedPermanentUsers.length > 0) {
  throw new Error(
    `Community bootstrap refused: r/${targetSubreddit} live communication protection has not converged for `
    + `${unprotectedPermanentUsers.sort().join(', ')}. Start the dual-community Mae runtime and let its projection complete first.`,
  );
}

console.log(`Cloning flair templates: r/${sourceSubreddit} -> r/${targetSubreddit}`);
const result = await new FlairCloner(read, write).clone(
  sourceSubreddit,
  targetSubreddit,
  { copyAssignments: false },
);

const [sourceUserTemplates, sourcePostTemplates, sourceAssignments, targetUserTemplates, targetPostTemplates, targetAssignmentsBefore] = await Promise.all([
  read.userFlairTemplates(sourceSubreddit),
  read.postFlairTemplates(sourceSubreddit),
  read.userFlairAssignments(sourceSubreddit),
  read.userFlairTemplates(targetSubreddit),
  read.postFlairTemplates(targetSubreddit),
  read.userFlairAssignments(targetSubreddit),
]);

const norm = (value: string | null): string => value ?? '';
const samePresentation = (left: RedditFlairTemplate, right: RedditFlairTemplate): boolean =>
  left.text === right.text
  && norm(left.cssClass) === norm(right.cssClass)
  && norm(left.textColour) === norm(right.textColour)
  && norm(left.backgroundColour) === norm(right.backgroundColour)
  && left.modOnly === right.modOnly
  && left.textEditable === right.textEditable
  && norm(left.allowableContent) === norm(right.allowableContent)
  && (left.maxEmojis ?? 0) === (right.maxEmojis ?? 0);

const mappings = (kind: 'user' | 'post', sourceTemplates: readonly RedditFlairTemplate[], targetTemplates: readonly RedditFlairTemplate[]) =>
  sourceTemplates.map(template => {
    const matches = targetTemplates.filter(targetTemplate => samePresentation(template, targetTemplate));
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one cloned ${kind} flair destination for ${template.id}, found ${matches.length}`);
    }
    const destination = matches[0];
    if (destination === undefined) throw new Error(`Cloned ${kind} flair destination disappeared for ${template.id}`);
    return {
      kind,
      sourceTemplateId: template.id,
      targetTemplateId: destination.id,
      text: template.text,
      cssClass: template.cssClass,
    } as const;
  });

const userFlairMappings = mappings('user', sourceUserTemplates, targetUserTemplates);
const postFlairMappings = mappings('post', sourcePostTemplates, targetPostTemplates);
const projectionCatalogue = parseMap(JSON.stringify({
  schema: 2,
  generatedAt: new Date().toISOString(),
  sourceSubreddit,
  targetSubreddit,
  userTemplates: {
    source: sourceUserTemplates,
    target: targetUserTemplates,
    mapping: userFlairMappings,
  },
  postTemplates: {
    source: sourcePostTemplates,
    target: targetPostTemplates,
    mapping: postFlairMappings,
  },
}));

const flairRestores = communityFlairRestores(
  projectionCatalogue,
  reputationRaw,
  targetSubreddit,
  targetAssignmentsBefore,
);
let canonicalFlairsApplied = 0;
for (const flair of flairRestores) {
  await write.setUserFlairTemplate(
    targetSubreddit,
    flair.username,
    flair.templateId,
    flair.customText,
  );
  canonicalFlairsApplied += 1;
}

console.log(`Cloning sticky posts with mapped post flairs: r/${sourceSubreddit} -> r/${targetSubreddit}`);
const stickyPosts = await cloneStickyPosts(
  read,
  write,
  sourceSubreddit,
  targetSubreddit,
  sourcePostTemplates,
  targetPostTemplates,
  postFlairMappings,
);
for (const sticky of stickyPosts) {
  await mirror.completePair(
    mirrorKey(sourceSubreddit, sticky.sourcePostId),
    sticky.sourceFullname,
    mirrorKey(targetSubreddit, sticky.targetPostId),
    `t3_${sticky.targetPostId}`,
  );
}

const migratedBans: {
  username: string;
  targetBanAlreadyPresent: boolean;
  targetBanApplied: boolean;
}[] = [];
for (const username of [...canonicalBans.values()].sort((left, right) => left.localeCompare(right))) {
  // Refresh immediately before exposing the target ban and advance the target
  // projection checkpoint so the normal runtime does not duplicate this write.
  await write.muteUser(targetSubreddit, username, 'Mae permanent reputation enforcement');
  await projection.markMute(targetSubreddit, username, 'mute', Date.now());
  const alreadyPresent = targetBanKeysBefore.has(username.toLowerCase());
  if (!alreadyPresent) {
    await write.banUser(
      targetSubreddit,
      username,
      'Mae canonical moderation state',
      `Canonical Mae reputation state migrated from r/${sourceSubreddit}.`,
    );
  }
  migratedBans.push({
    username,
    targetBanAlreadyPresent: alreadyPresent,
    targetBanApplied: !alreadyPresent,
  });
}

const [targetBansAfter, targetMutedAfter, targetAssignmentsAfter] = await Promise.all([
  read.bannedUsers(targetSubreddit),
  read.mutedUsers(targetSubreddit),
  read.userFlairAssignments(targetSubreddit),
]);
const targetBanAfterKeys = new Set(targetBansAfter.map(item => item.username.toLowerCase()));
const targetMuteAfterKeys = new Set(targetMutedAfter.map(item => item.username.toLowerCase()));
for (const username of canonicalBans.values()) {
  const key = username.toLowerCase();
  if (!targetMuteAfterKeys.has(key)) {
    throw new Error(`Communication protection verification failed for u/${username}`);
  }
  if (!targetBanAfterKeys.has(key)) {
    throw new Error(`Ban migration verification failed for u/${username}`);
  }
}
const targetUnexpectedAfter = [...targetBanAfterKeys].filter(key => !canonicalBanKeys.has(key));
if (targetUnexpectedAfter.length > 0) {
  throw new Error(`Unexpected target bans remain after migration: ${targetUnexpectedAfter.join(', ')}`);
}

const remainingFlairRestores = communityFlairRestores(
  projectionCatalogue,
  reputationRaw,
  targetSubreddit,
  targetAssignmentsAfter,
);
if (remainingFlairRestores.length > 0) {
  throw new Error(
    `Canonical target flair verification failed for: ${remainingFlairRestores.map(item => item.username).join(', ')}`,
  );
}

const catalogueFile = resolve(
  process.cwd(),
  process.env['REDDIT_FLAIR_CATALOGUE_FILE']?.trim() || 'data/flairs.json',
);
const catalogue = {
  schema: 2,
  generatedAt: new Date().toISOString(),
  sourceSubreddit,
  targetSubreddit,
  publishingPrimaryAtBootstrap: cfg.primarySubreddit,
  userTemplates: {
    source: sourceUserTemplates,
    target: targetUserTemplates,
    mapping: userFlairMappings,
  },
  postTemplates: {
    source: sourcePostTemplates,
    target: targetPostTemplates,
    mapping: postFlairMappings,
  },
  stickyPosts,
  userAssignments: {
    source: sourceAssignments,
    targetBefore: targetAssignmentsBefore,
    targetAfter: targetAssignmentsAfter,
    canonicalApplied: canonicalFlairsApplied,
  },
  moderationStatus: {
    canonicalBannedOrScamUsers: [...canonicalBans.values()].sort((a, b) => a.localeCompare(b)),
    sourceSubredditBans: sourceBans,
    targetBansBefore,
    targetMutedBefore,
    migratedBans,
    targetBansAfter,
    targetMutedAfter,
  },
  cloneResult: result,
};

await mkdir(dirname(catalogueFile), { recursive: true });
const temp = `${catalogueFile}.tmp.${process.pid}`;
await writeFile(temp, `${JSON.stringify(catalogue, null, 2)}\n`, { mode: 0o600 });
await rename(temp, catalogueFile);

console.log(`user templates created=${result.userTemplatesCreated}`);
console.log(`post templates created=${result.postTemplatesCreated}`);
console.log(`canonical user flairs applied=${canonicalFlairsApplied}`);
console.log(`sticky posts cloned/reused=${stickyPosts.length}`);
for (const sticky of stickyPosts) {
  console.log(`sticky slot ${sticky.slot}: ${sticky.sourceFullname} -> t3_${sticky.targetPostId} mode=${sticky.mode}`);
}
console.log(`canonical banned/scam users reconciled=${canonicalBans.size}`);
console.log(`target bans before=${targetBansBefore.length} after=${targetBansAfter.length}`);
console.log(`target mutes before=${targetMutedBefore.length} after=${targetMutedAfter.length}`);
console.log(`canonical flair catalogue=${catalogueFile}`);
console.log('Canonical flair, sticky and moderation-state bootstrap complete.');
