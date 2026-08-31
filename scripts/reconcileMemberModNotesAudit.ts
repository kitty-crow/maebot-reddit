import 'dotenv/config';
import { constants } from 'node:fs';
import { access, copyFile, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { redditConfig, redditModerationConfig } from '../src/env.ts';
import { parseMemberAuditLog, type MemberAuditResult } from '../src/modnotes/auditResults.ts';
import { memberInventoryFromReputation } from '../src/modnotes/inventory.ts';
import { MemberModNotesRedditClient } from '../src/modnotes/reddit.ts';
import { MemberModNoteStore } from '../src/modnotes/store.ts';
import { reconcileReputationAudit } from '../src/reputation/auditReconcile.ts';
import {
  BAN_TRIGGER_POINTS,
  REPUTATION_FLOOR,
  clampReputationPoints,
} from '../src/reputation/policy.ts';
import { ReputationStore } from '../src/reputation/store.ts';
import { safeError } from '../src/reddit/error.ts';
import { Store } from '../src/store/store.ts';

const canonicalCommunities = ['catgirlcoin', 'nyaonearth'] as const;
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const baseArg = args.find(arg => arg.startsWith('--base='));
const completionArgs = args.filter(arg => arg.startsWith('--completion='));
const overlayArgs = args.filter(arg => arg.startsWith('--overlay='));
const expectArg = args.find(arg => arg.startsWith('--expect-overrides='));

if (baseArg === undefined) {
  throw new Error(
    'Usage: --base=<full-audit.log> [--completion=<missing-users.log> ...] '
    + '[--overlay=<corrected.log> ...] [--expect-overrides=N] [--apply]',
  );
}
if (apply && process.env['MEMBER_MOD_NOTES_RECONCILE'] !== '1') {
  throw new Error('Live audit reconciliation requires MEMBER_MOD_NOTES_RECONCILE=1');
}

const baseFile = resolve(process.cwd(), baseArg.slice('--base='.length));
const sourceReputationFile = resolve(dirname(baseFile), 'reputation.pb');
const completionFiles = completionArgs.map(arg => resolve(process.cwd(), arg.slice('--completion='.length)));
const overlayFiles = overlayArgs.map(arg => resolve(process.cwd(), arg.slice('--overlay='.length)));
const expectedOverrides = expectArg === undefined ? null : Number(expectArg.slice('--expect-overrides='.length));
if (expectedOverrides !== null && (!Number.isSafeInteger(expectedOverrides) || expectedOverrides < 0)) {
  throw new Error('--expect-overrides must be a non-negative safe integer');
}

const baseRaw = await readFile(baseFile, 'utf8');
const base = parseMemberAuditLog(baseRaw);
if (base.declaredMembers === null) throw new Error('Base audit log has no Members: header');
if (base.duplicateUsers.length > 0) {
  throw new Error(`Base audit contains duplicate USER RESULT blocks: ${base.duplicateUsers.join(', ')}`);
}
if (base.results.length > base.declaredMembers) {
  throw new Error(`Base audit contains more final results than declared members: ${base.results.length}/${base.declaredMembers}`);
}

await access(sourceReputationFile);
const sourceSnapshot = new ReputationStore(sourceReputationFile);
const sourceInventory = memberInventoryFromReputation(await sourceSnapshot.raw());
const expectedUsers = sourceInventory
  .filter(user => !user.moderator)
  .map(user => user.username)
  .sort((a, b) => a.localeCompare(b));
if (expectedUsers.length !== base.declaredMembers) {
  throw new Error(
    `Original audit snapshot/member-count mismatch: declared=${base.declaredMembers} snapshot=${expectedUsers.length}`,
  );
}
const expected = new Map(expectedUsers.map(username => [username.toLowerCase(), username]));
for (const username of base.attemptedUsers) {
  if (!expected.has(username.toLowerCase())) {
    throw new Error(`Base audit attempted u/${username}, which is absent from its reputation snapshot`);
  }
}
for (const result of base.results) {
  if (!expected.has(result.username.toLowerCase())) {
    throw new Error(`Base audit result u/${result.username} is absent from its reputation snapshot`);
  }
}

const final = new Map(base.results.map(result => [result.username.toLowerCase(), result]));
const completed = new Set<string>();
const overridden = new Set<string>();
const sourceHash = createHash('sha256')
  .update(baseRaw)
  .update('\0snapshot\0')
  .update(await readFile(sourceReputationFile));

for (const file of completionFiles) {
  const raw = await readFile(file, 'utf8');
  sourceHash.update('\0completion\0').update(raw);
  const completion = parseMemberAuditLog(raw);
  if (completion.duplicateUsers.length > 0) {
    throw new Error(`Completion log ${file} contains duplicate USER RESULT blocks: ${completion.duplicateUsers.join(', ')}`);
  }
  for (const result of completion.results) {
    const key = result.username.toLowerCase();
    if (!expected.has(key)) {
      throw new Error(`Completion log ${file} contains u/${result.username}, which is absent from the original audit snapshot`);
    }
    if (final.has(key) || completed.has(key)) {
      throw new Error(`Completion logs repeat an already completed base-audit user: u/${result.username}`);
    }
    final.set(key, result);
    completed.add(key);
  }
}

for (const file of overlayFiles) {
  const raw = await readFile(file, 'utf8');
  sourceHash.update('\0correction\0').update(raw);
  const overlay = parseMemberAuditLog(raw);
  if (overlay.duplicateUsers.length > 0) {
    throw new Error(`Corrected overlay ${file} contains duplicate USER RESULT blocks: ${overlay.duplicateUsers.join(', ')}`);
  }
  for (const result of overlay.results) {
    const key = result.username.toLowerCase();
    if (!expected.has(key)) {
      throw new Error(`Corrected overlay contains u/${result.username}, which is absent from the original audit snapshot`);
    }
    final.set(key, result);
    overridden.add(key);
  }
}
if (expectedOverrides !== null && overridden.size !== expectedOverrides) {
  throw new Error(`Corrected overlay coverage mismatch: expected=${expectedOverrides} actual=${overridden.size}`);
}

if (final.size !== base.declaredMembers) {
  const missing = expectedUsers.filter(username => !final.has(username.toLowerCase()));
  const preview = missing.slice(0, 25).map(username => `u/${username}`).join(', ');
  const more = missing.length > 25 ? `, ... +${missing.length - 25} more` : '';
  throw new Error(
    `Audit result set is incomplete: declared=${base.declaredMembers} final-results=${final.size} missing=${missing.length}. `
    + `Missing: ${preview}${more}. Complete only these users with scripts/completeMemberModNotesAudit.sh.`,
  );
}

const auditId = sourceHash.digest('hex').slice(0, 16);
const results = [...final.values()].sort((a, b) => a.username.localeCompare(b.username));

const validateAuditResult = (result: MemberAuditResult): void => {
  const points = result.afterPoints;
  const status = result.afterStatus;
  if (clampReputationPoints(points) !== points) {
    throw new Error(`Audit score for u/${result.username} is outside member reputation bounds`);
  }
  if (status === 'moderator') throw new Error(`Audit result unexpectedly targets moderator u/${result.username}`);
  if (status === 'banned' || status === 'scam') {
    if (points !== REPUTATION_FLOOR) {
      throw new Error(`Permanent status for u/${result.username} does not use the reputation floor`);
    }
    return;
  }
  if (points <= BAN_TRIGGER_POINTS) {
    throw new Error(`Non-permanent audit result for u/${result.username} is at or below the ban trigger: ${points}/${status}`);
  }
};
for (const result of results) validateAuditResult(result);

const moderationCfg = redditModerationConfig();
if (moderationCfg === null) throw new Error('Audit reconciliation requires REDDIT_MODERATION_ENABLED=true');
const reputation = new ReputationStore(moderationCfg.stateFile);
const inventory = memberInventoryFromReputation(await reputation.raw());
const inventoryByName = new Map(inventory.map(row => [row.username.toLowerCase(), row]));
const absent = results.filter(result => !inventoryByName.has(result.username.toLowerCase()));
if (absent.length > 0) {
  throw new Error(`Audit users missing from canonical reputation: ${absent.map(row => `u/${row.username}`).join(', ')}`);
}
const moderators = results.filter(result => inventoryByName.get(result.username.toLowerCase())?.moderator === true);
if (moderators.length > 0) {
  throw new Error(`Audit reconciliation reached moderators: ${moderators.map(row => `u/${row.username}`).join(', ')}`);
}
const extras = inventory.filter(row => !row.moderator && !final.has(row.username.toLowerCase()));

console.log('='.repeat(96));
console.log('MAE MEMBER MOD NOTES COMPLETED-AUDIT RECONCILIATION');
console.log('='.repeat(96));
console.log(`Base audit: ${baseFile}`);
console.log(`Original audit snapshot: ${sourceReputationFile}`);
console.log(`Original audit population: ${expectedUsers.length}`);
console.log(`Base attempted users visible in log: ${base.attemptedUsers.length}`);
console.log(`Base final results: ${base.results.length}/${base.declaredMembers}`);
for (const file of completionFiles) console.log(`Missing-user completion: ${file}`);
for (const file of overlayFiles) console.log(`Corrected overlay: ${file}`);
console.log(`Audit id: ${auditId}`);
console.log(`Audited members: ${results.length}`);
console.log(`Recovered missing users: ${completed.size}`);
console.log(`Corrected overrides: ${overridden.size}`);
console.log(`Current non-moderators not present in historical audit: ${extras.length} (left untouched)`);
console.log(`Mode: ${apply ? 'APPLY' : 'PREVIEW'}`);
console.log('No Reddit history fetches and no LLM calls are performed by this command.');
console.log('='.repeat(96));

let changedScores = 0;
for (const result of results) {
  const current = await reputation.user(result.username);
  if (current === null) throw new Error(`Canonical reputation user disappeared: u/${result.username}`);
  if (current.points !== result.afterPoints || current.status !== result.afterStatus) changedScores += 1;
}
console.log(`Score/status records requiring reconciliation now: ${changedScores}/${results.length}`);
if (!apply) process.exit(0);

await access(moderationCfg.stateFile);
const backup = `${moderationCfg.stateFile}.pre-member-audit-${auditId}.bak`;
await mkdir(dirname(resolve(process.cwd(), backup)), { recursive: true });
try {
  await copyFile(moderationCfg.stateFile, backup, constants.COPYFILE_EXCL);
  console.log(`Canonical reputation backup: ${backup}`);
} catch (error) {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : null;
  if (code !== 'EEXIST') throw error;
  console.log(`Canonical reputation backup already exists: ${backup}`);
}

const rawReputation = new Store(moderationCfg.stateFile, { schema: 1 });
const reconciledAt = Math.floor(Date.now() / 1_000);
await rawReputation.edit(current => reconcileReputationAudit(current, results, auditId, reconciledAt));
console.log(`Canonical reputation reconciled for ${results.length} audited users.`);

const notesFile = resolve(process.cwd(), process.env['REDDIT_MEMBER_MOD_NOTES_FILE']?.trim() || 'data/memberModNotes.pb');
const notes = new MemberModNoteStore(notesFile);
await notes.seed(results.map(result => result.username));
const reddit = new MemberModNotesRedditClient(redditConfig().auth);
let posted = 0;
let deleted = 0;
let skipped = 0;
let failed = 0;

for (let index = 0; index < results.length; index += 1) {
  const result = results[index];
  if (result === undefined) continue;
  const previous = await notes.record(result.username);
  const same = previous !== null
    && previous.note === result.note
    && previous.summary === result.summary
    && previous.label === result.label;
  if (!same) {
    await notes.generated(
      result.username,
      result.note,
      result.summary,
      result.label,
      [],
      Math.floor(Date.now() / 1_000),
    );
  }
  const current = await notes.record(result.username);
  if (current === null) throw new Error(`Member note record disappeared for u/${result.username}`);
  const failures: string[] = [];

  for (const community of canonicalCommunities) {
    const oldId = current.nativeNotes.find(entry => entry.subreddit === community)?.noteId ?? null;
    const alreadyApplied = same
      && current.appliedTo.some(value => value.toLowerCase() === community)
      && oldId !== null;
    if (alreadyApplied) {
      skipped += 1;
      continue;
    }
    try {
      const newId = await reddit.addModNote(community, result.username, result.note, result.label);
      await notes.markNativeNote(result.username, community, newId);
      await notes.markApplied(result.username, community);
      posted += 1;
      if (oldId !== null && oldId !== newId) {
        try {
          await reddit.deleteModNote(community, result.username, oldId);
          deleted += 1;
        } catch (error) {
          failed += 1;
          failures.push(`r/${community} old-note delete: ${safeError(error)}`);
        }
      }
    } catch (error) {
      failed += 1;
      failures.push(`r/${community} note create: ${safeError(error)}`);
    }
  }

  if (failures.length > 0) await notes.failed(result.username, failures.join(' | '));
  const done = index + 1;
  if (done === results.length || done % 10 === 0 || failures.length > 0) {
    console.log(`[Member audit reconcile] ${done}/${results.length} u/${result.username} posted=${posted} skipped=${skipped} failed=${failed}`);
  }
}

console.log('='.repeat(96));
console.log(`COMPLETE users=${results.length} notes-posted=${posted} old-notes-deleted=${deleted} already-applied=${skipped} failed=${failed}`);
console.log('Re-run the same command after a transient Reddit failure; score reconciliation is idempotent and tracked notes resume from memberModNotes.pb.');
console.log('='.repeat(96));
if (failed > 0) process.exitCode = 1;
