import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseMemberAuditLog } from '../src/modnotes/auditResults.ts';
import { memberInventoryFromReputation } from '../src/modnotes/inventory.ts';
import { ReputationStore } from '../src/reputation/store.ts';

const args = process.argv.slice(2);
const baseArg = args.find(arg => arg.startsWith('--base='));
const reputationArg = args.find(arg => arg.startsWith('--reputation='));
const completionArgs = args.filter(arg => arg.startsWith('--completion='));

if (baseArg === undefined || reputationArg === undefined) {
  throw new Error(
    'Usage: --base=<full-audit.log> --reputation=<original-audit-reputation.pb> '
    + '[--completion=<completion.log> ...]',
  );
}

const baseFile = resolve(process.cwd(), baseArg.slice('--base='.length));
const reputationFile = resolve(process.cwd(), reputationArg.slice('--reputation='.length));
const base = parseMemberAuditLog(await readFile(baseFile, 'utf8'));
if (base.declaredMembers === null) throw new Error('Base audit log has no Members: header');
if (base.duplicateUsers.length > 0) {
  throw new Error(`Base audit contains duplicate USER RESULT blocks: ${base.duplicateUsers.join(', ')}`);
}

const snapshot = new ReputationStore(reputationFile);
const inventory = memberInventoryFromReputation(await snapshot.raw());
const expectedUsers = inventory
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

const completed = new Set(base.results.map(result => result.username.toLowerCase()));
for (const rawArg of completionArgs) {
  const file = resolve(process.cwd(), rawArg.slice('--completion='.length));
  const parsed = parseMemberAuditLog(await readFile(file, 'utf8'));
  if (parsed.duplicateUsers.length > 0) {
    throw new Error(`Completion log ${file} contains duplicate USER RESULT blocks: ${parsed.duplicateUsers.join(', ')}`);
  }
  for (const result of parsed.results) {
    const key = result.username.toLowerCase();
    if (!expected.has(key)) throw new Error(`Completion log ${file} contains non-audit user u/${result.username}`);
    completed.add(key);
  }
}

const missing = expectedUsers.filter(username => !completed.has(username.toLowerCase()));
console.error(
  `Base declared=${base.declaredMembers} attempted=${base.attemptedUsers.length} completed=${base.results.length} `
  + `completed-with-recovery=${completed.size} missing=${missing.length}`,
);
for (const username of missing) console.log(username);
