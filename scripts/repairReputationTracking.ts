import 'dotenv/config';
import { access, copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { redditConfig, redditModerationConfig } from '../src/env.ts';
import { CATGIRLCOIN_REPUTATION_FLAIRS } from '../src/reputation/liveFlairs.ts';
import {
  isMisspelledPawsomeFlair,
  repairReputationTracking,
  reputationUsersRequiringReview,
  type LiveTrackingFlair,
} from '../src/reputation/trackingRepair.ts';
import { RedditReadClient } from '../src/reddit/client.ts';
import { safeError } from '../src/reddit/error.ts';
import { RedditMutationClient } from '../src/reddit/mutate.ts';
import { Store } from '../src/store/store.ts';
import { isMap, type Json } from '../src/types/json.ts';

const sourceSubreddit = 'catgirlcoin';
const cfg = redditConfig();
const moderationCfg = redditModerationConfig();
if (moderationCfg === null) throw new Error('REDDIT_MODERATION_ENABLED must be true for reputation tracking repair');
if (cfg.sourceSubreddit.toLowerCase() !== sourceSubreddit) {
  throw new Error('Reputation tracking repair requires REDDIT_SOURCE_SUBREDDIT=catgirlcoin');
}

const read = new RedditReadClient(cfg.auth);
const write = new RedditMutationClient(cfg.auth);
const stateFile = resolve(process.cwd(), moderationCfg.stateFile);
const store = new Store(stateFile, null);
const canonical = CATGIRLCOIN_REPUTATION_FLAIRS.user.pawsomeContributor;
const lower = (value: string): string => value.trim().toLowerCase();
const text = (value: Json | undefined): string | null => typeof value === 'string' ? value : null;

const sleep = async (milliseconds: number): Promise<void> => {
  await new Promise<void>(resolvePromise => setTimeout(resolvePromise, milliseconds));
};

const unresolvedMisspelledUsers = (value: Json): readonly string[] => {
  if (!isMap(value) || !isMap(value['users'])) throw new Error('Canonical reputation users map is missing');
  const usernames: string[] = [];
  for (const [key, raw] of Object.entries(value['users'])) {
    if (!isMap(raw)) continue;
    if (raw['status'] !== 'unmapped' && raw['needsReview'] !== true) continue;
    if (!isMisspelledPawsomeFlair(text(raw['currentFlairText']))) continue;
    usernames.push(text(raw['username']) ?? key);
  }
  return usernames.sort((left, right) => left.localeCompare(right));
};

const liveFlair = (
  username: string,
  assignments: ReadonlyMap<string, { readonly templateId: string | null; readonly text: string | null; readonly cssClass: string | null }>,
): LiveTrackingFlair => {
  const assignment = assignments.get(lower(username));
  return {
    username,
    templateId: assignment?.templateId ?? null,
    text: assignment?.text ?? null,
    cssClass: assignment?.cssClass ?? null,
  };
};

const backupPath = (): string => {
  const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('-', '').replace(/\.\d{3}Z$/u, 'Z');
  return resolve(process.cwd(), 'data', 'reputation-backups', `tracking-repair-${stamp}`, 'reputation.pb');
};

try {
  await access(stateFile);
  const reputationBefore = await store.read();
  const localTypoUsers = unresolvedMisspelledUsers(reputationBefore);

  const [templates, assignmentsBefore, moderators] = await Promise.all([
    read.userFlairTemplates(sourceSubreddit),
    read.userFlairAssignments(sourceSubreddit),
    read.moderators(sourceSubreddit),
  ]);

  const canonicalTemplate = templates.find(template => template.id === canonical.id);
  if (canonicalTemplate === undefined) throw new Error(`Canonical Pawsome flair template ${canonical.id} is missing from Reddit`);
  if (canonicalTemplate.text !== canonical.text || (canonicalTemplate.cssClass ?? null) !== canonical.cssClass) {
    throw new Error('Canonical Pawsome flair template no longer matches the expected live definition');
  }

  const misspelledBefore = assignmentsBefore.filter(assignment => isMisspelledPawsomeFlair(assignment.text));
  console.log(`Reddit misspelled Pawsome assignments before repair: ${misspelledBefore.length}`);
  for (const assignment of misspelledBefore) {
    console.log(`  u/${assignment.username}\t${JSON.stringify(assignment.text)}`);
  }

  for (const assignment of misspelledBefore) {
    await write.setUserFlairTemplate(sourceSubreddit, assignment.username, canonical.id, null);
  }

  let assignmentsAfter = await read.userFlairAssignments(sourceSubreddit);
  let remainingMisspellings = assignmentsAfter.filter(assignment => isMisspelledPawsomeFlair(assignment.text));
  for (let attempt = 1; remainingMisspellings.length > 0 && attempt < 3; attempt += 1) {
    await sleep(1_000);
    assignmentsAfter = await read.userFlairAssignments(sourceSubreddit);
    remainingMisspellings = assignmentsAfter.filter(assignment => isMisspelledPawsomeFlair(assignment.text));
  }
  if (remainingMisspellings.length > 0) {
    throw new Error(
      `Reddit still has misspelled Pawsome flair text for: ${remainingMisspellings.map(item => `u/${item.username}`).join(', ')}`,
    );
  }
  console.log('Reddit misspelled Pawsome assignments after repair: 0');

  const assignmentsByUser = new Map(assignmentsAfter.map(assignment => [lower(assignment.username), assignment]));
  for (const username of localTypoUsers) {
    const assignment = assignmentsByUser.get(lower(username));
    if (assignment?.templateId !== canonical.id || assignment.text !== canonical.text) {
      throw new Error(`Reddit did not verify canonical Pawsome flair for u/${username}`);
    }
  }

  const moderatorTracking = moderators.map(moderator => liveFlair(moderator.name, assignmentsByUser));
  const backup = backupPath();
  await mkdir(dirname(backup), { recursive: true });
  await copyFile(stateFile, backup);
  console.log(`Reputation backup: ${backup}`);

  let moderatorsRepaired = 0;
  let pawsomeRepaired = 0;
  await store.edit(current => {
    const repaired = repairReputationTracking(current, {
      at: Math.floor(Date.now() / 1_000),
      moderators: moderatorTracking,
      pawsome: {
        templateId: canonical.id,
        text: canonical.text,
        cssClass: canonical.cssClass,
        usernames: localTypoUsers,
      },
    });
    moderatorsRepaired = repaired.moderatorsRepaired;
    pawsomeRepaired = repaired.pawsomeRepaired;
    return repaired.value;
  });

  const reputationAfter = await store.read();
  const unresolved = reputationUsersRequiringReview(reputationAfter);
  if (unresolved.length > 0) {
    throw new Error(`Reputation tracking still has unresolved users: ${unresolved.map(username => `u/${username}`).join(', ')}`);
  }
  if (!isMap(reputationAfter) || !isMap(reputationAfter['users'])) {
    throw new Error('Canonical reputation users map disappeared after repair');
  }
  const localMisspellings: string[] = [];
  for (const [key, raw] of Object.entries(reputationAfter['users'])) {
    if (!isMap(raw)) continue;
    if (
      isMisspelledPawsomeFlair(text(raw['currentFlairText']))
      || isMisspelledPawsomeFlair(text(raw['desiredFlairText']))
    ) localMisspellings.push(text(raw['username']) ?? key);
  }
  if (localMisspellings.length > 0) {
    throw new Error(`Reputation tracking still contains misspelled Pawsome text for: ${localMisspellings.join(', ')}`);
  }

  console.log(`Canonical Pawsome tracking records repaired: ${pawsomeRepaired}`);
  console.log(`Canonical CatgirlCoin moderator records repaired: ${moderatorsRepaired}`);
  console.log('Reputation users requiring review: 0');
  console.log('Reputation misspelled Pawsome records: 0');
  console.log('Reddit misspelled Pawsome assignments: 0');
  console.log('Reputation tracking repair complete.');
} catch (error) {
  console.error(`Reputation tracking repair failed: ${safeError(error)}`);
  process.exitCode = 1;
}
