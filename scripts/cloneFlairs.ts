import 'dotenv/config';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { redditConfig } from '../src/env.ts';
import { FlairCloner } from '../src/flair/clone.ts';
import { RedditReadClient } from '../src/reddit/client.ts';
import { RedditMutationClient } from '../src/reddit/mutate.ts';
import type { RedditFlairAssignment, RedditFlairTemplate } from '../src/reddit/types.ts';
import { parseMap } from '../src/types/json.ts';

const cfg = redditConfig();
if (cfg.sourceSubreddit.toLowerCase() === cfg.primarySubreddit.toLowerCase()) {
  throw new Error('Source and primary subreddit must be different for flair migration');
}

const read = new RedditReadClient(cfg.auth);
const write = new RedditMutationClient(cfg.auth);
const [me, source, target] = await Promise.all([
  read.me(),
  read.subreddit(cfg.sourceSubreddit),
  read.subreddit(cfg.primarySubreddit),
]);
if (!source.userIsModerator) throw new Error(`${me.name} is not a moderator of r/${cfg.sourceSubreddit}`);
if (!target.userIsModerator) throw new Error(`${me.name} is not a moderator of r/${cfg.primarySubreddit}`);

console.log(`Cloning user and post flairs: r/${cfg.sourceSubreddit} -> r/${cfg.primarySubreddit}`);
const result = await new FlairCloner(read, write).clone(cfg.sourceSubreddit, cfg.primarySubreddit);

const [sourceUserTemplates, sourcePostTemplates, sourceAssignments, targetUserTemplates, targetPostTemplates, targetAssignments, sourceBans, targetBansBefore] = await Promise.all([
  read.userFlairTemplates(cfg.sourceSubreddit),
  read.postFlairTemplates(cfg.sourceSubreddit),
  read.userFlairAssignments(cfg.sourceSubreddit),
  read.userFlairTemplates(cfg.primarySubreddit),
  read.postFlairTemplates(cfg.primarySubreddit),
  read.userFlairAssignments(cfg.primarySubreddit),
  read.bannedUsers(cfg.sourceSubreddit),
  read.bannedUsers(cfg.primarySubreddit),
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

const legacyDbFile = resolve(
  process.cwd(),
  process.env['REDDIT_LEGACY_COMMENT_DB']?.trim() || 'database.db',
);
const legacyDb = parseMap(await readFile(legacyDbFile, 'utf8'));
const rawDbBanned = legacyDb['banned_users'];
if (rawDbBanned !== undefined && (!Array.isArray(rawDbBanned) || rawDbBanned.some(value => typeof value !== 'string'))) {
  throw new Error('legacy database banned_users must be an array of usernames');
}
const legacyDbBanned = (Array.isArray(rawDbBanned) ? rawDbBanned : []).map(value => String(value));

const uncivil = (assignment: RedditFlairAssignment): boolean =>
  assignment.cssClass === 'u' || assignment.cssClass === 's';
const uncivilAssignments = sourceAssignments.filter(uncivil);

const statusByUser = new Map<string, {
  username: string;
  sourceSubredditBan: boolean;
  legacyDbBanned: boolean;
  legacyUncivilFlair: boolean;
  targetBanAlreadyPresent: boolean;
  targetBanApplied: boolean;
}>();
const ensure = (username: string) => {
  const key = username.toLowerCase();
  const existing = statusByUser.get(key);
  if (existing !== undefined) return existing;
  const created = {
    username,
    sourceSubredditBan: false,
    legacyDbBanned: false,
    legacyUncivilFlair: false,
    targetBanAlreadyPresent: false,
    targetBanApplied: false,
  };
  statusByUser.set(key, created);
  return created;
};

for (const item of sourceBans) ensure(item.username).sourceSubredditBan = true;
for (const username of legacyDbBanned) ensure(username).legacyDbBanned = true;
for (const assignment of uncivilAssignments) ensure(assignment.username).legacyUncivilFlair = true;
const targetBanKeys = new Set(targetBansBefore.map(item => item.username.toLowerCase()));

for (const record of statusByUser.values()) {
  if (targetBanKeys.has(record.username.toLowerCase())) {
    record.targetBanAlreadyPresent = true;
    continue;
  }
  const reasons: string[] = [];
  if (record.sourceSubredditBan) reasons.push(`banned in r/${cfg.sourceSubreddit}`);
  if (record.legacyDbBanned) reasons.push('legacy Mae banned_users');
  if (record.legacyUncivilFlair) reasons.push('legacy uncivil flair (u/s)');
  await write.banUser(
    cfg.primarySubreddit,
    record.username,
    'Migrated legacy moderation state',
    `Mae Reddit migration: ${reasons.join('; ')}`,
  );
  record.targetBanApplied = true;
}

const targetBansAfter = await read.bannedUsers(cfg.primarySubreddit);
const targetBanAfterKeys = new Set(targetBansAfter.map(item => item.username.toLowerCase()));
for (const record of statusByUser.values()) {
  if (!targetBanAfterKeys.has(record.username.toLowerCase())) {
    throw new Error(`Ban migration verification failed for u/${record.username}`);
  }
}

const catalogueFile = resolve(
  process.cwd(),
  process.env['REDDIT_FLAIR_CATALOGUE_FILE']?.trim() || 'data/flairs.json',
);
const catalogue = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  sourceSubreddit: cfg.sourceSubreddit,
  targetSubreddit: cfg.primarySubreddit,
  userTemplates: {
    source: sourceUserTemplates,
    target: targetUserTemplates,
    mapping: mappings('user', sourceUserTemplates, targetUserTemplates),
  },
  postTemplates: {
    source: sourcePostTemplates,
    target: targetPostTemplates,
    mapping: mappings('post', sourcePostTemplates, targetPostTemplates),
  },
  userAssignments: {
    source: sourceAssignments,
    target: targetAssignments,
  },
  moderationStatus: {
    sourceSubredditBans: sourceBans,
    legacyDbBannedUsers: legacyDbBanned,
    legacyUncivilAssignments: uncivilAssignments,
    targetBansBefore,
    migratedUsers: [...statusByUser.values()].sort((a, b) => a.username.localeCompare(b.username)),
    targetBansAfter,
  },
  cloneResult: result,
};

await mkdir(dirname(catalogueFile), { recursive: true });
const temp = `${catalogueFile}.tmp.${process.pid}`;
await writeFile(temp, `${JSON.stringify(catalogue, null, 2)}\n`, { mode: 0o600 });
await rename(temp, catalogueFile);

console.log(`user templates created=${result.userTemplatesCreated}`);
console.log(`post templates created=${result.postTemplatesCreated}`);
console.log(`user assignments applied=${result.userAssignmentsApplied}`);
console.log(`user assignments already correct=${result.userAssignmentsAlreadyCorrect}`);
console.log(`legacy/source moderation users migrated=${statusByUser.size}`);
console.log(`target bans before=${targetBansBefore.length} after=${targetBansAfter.length}`);
console.log(`canonical flair catalogue=${catalogueFile}`);
console.log('Flair and moderation-state clone complete.');
