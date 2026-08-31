import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseMemberAuditLog } from '../src/modnotes/auditResults.ts';

const args = process.argv.slice(2);
const baseArg = args.find(arg => arg.startsWith('--base='));
const completionArgs = args.filter(arg => arg.startsWith('--completion='));

if (baseArg === undefined) {
  throw new Error('Usage: --base=<full-audit.log> [--completion=<completion.log> ...]');
}

const baseFile = resolve(process.cwd(), baseArg.slice('--base='.length));
const base = parseMemberAuditLog(await readFile(baseFile, 'utf8'));
if (base.declaredMembers === null) throw new Error('Base audit log has no Members: header');
if (base.attemptedUsers.length !== base.declaredMembers) {
  throw new Error(
    `Base audit attempted-member coverage mismatch: declared=${base.declaredMembers} attempted=${base.attemptedUsers.length}`,
  );
}
if (base.duplicateUsers.length > 0) {
  throw new Error(`Base audit contains duplicate USER RESULT blocks: ${base.duplicateUsers.join(', ')}`);
}

const attempted = new Map(base.attemptedUsers.map(username => [username.toLowerCase(), username]));
const completed = new Set(base.results.map(result => result.username.toLowerCase()));

for (const rawArg of completionArgs) {
  const file = resolve(process.cwd(), rawArg.slice('--completion='.length));
  const parsed = parseMemberAuditLog(await readFile(file, 'utf8'));
  if (parsed.duplicateUsers.length > 0) {
    throw new Error(`Completion log ${file} contains duplicate USER RESULT blocks: ${parsed.duplicateUsers.join(', ')}`);
  }
  for (const result of parsed.results) {
    const key = result.username.toLowerCase();
    if (!attempted.has(key)) throw new Error(`Completion log ${file} contains non-base user u/${result.username}`);
    completed.add(key);
  }
}

const missing = base.attemptedUsers.filter(username => !completed.has(username.toLowerCase()));
console.error(
  `Base declared=${base.declaredMembers} completed=${base.results.length} prior-completions=${completed.size - base.results.length} missing=${missing.length}`,
);
for (const username of missing) console.log(username);
