import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { redditConfig } from '../src/env.ts';
import { parseMemberAuditLog, type MemberAuditResult } from '../src/modnotes/auditResults.ts';
import { MemberModNotesRedditClient } from '../src/modnotes/reddit.ts';
import { MemberModNoteStore } from '../src/modnotes/store.ts';
import {
  BAN_TRIGGER_POINTS,
  REPUTATION_FLOOR,
  clampReputationPoints,
} from '../src/reputation/policy.ts';
import { safeError } from '../src/reddit/error.ts';

const communities = ['catgirlcoin', 'nyaonearth'] as const;
const args = process.argv.slice(2);
const baseArg = args.find(arg => arg.startsWith('--base='));
const completionArgs = args.filter(arg => arg.startsWith('--completion='));
const overlayArgs = args.filter(arg => arg.startsWith('--overlay='));
const expectOverridesArg = args.find(arg => arg.startsWith('--expect-overrides='));
const expectAuditIdArg = args.find(arg => arg.startsWith('--expect-audit-id='));

if (process.env['MEMBER_MOD_NOTES_NATIVE_APPLY'] !== '1') {
  throw new Error('Native Reddit Mod Note application requires MEMBER_MOD_NOTES_NATIVE_APPLY=1');
}
if (baseArg === undefined || expectAuditIdArg === undefined) {
  throw new Error(
    'Usage: --base=<full-audit.log> [--completion=<missing-users.log> ...] '
    + '[--overlay=<corrected.log> ...] [--expect-overrides=N] --expect-audit-id=<16-hex-id>',
  );
}

const baseFile = resolve(process.cwd(), baseArg.slice('--base='.length));
const sourceReputationFile = resolve(dirname(baseFile), 'reputation.pb');
const completionFiles = completionArgs.map(arg => resolve(process.cwd(), arg.slice('--completion='.length)));
const overlayFiles = overlayArgs.map(arg => resolve(process.cwd(), arg.slice('--overlay='.length)));
const expectedOverrides = expectOverridesArg === undefined
  ? null
  : Number(expectOverridesArg.slice('--expect-overrides='.length));
const expectedAuditId = expectAuditIdArg.slice('--expect-audit-id='.length).trim();

if (expectedOverrides !== null && (!Number.isSafeInteger(expectedOverrides) || expectedOverrides < 0)) {
  throw new Error('--expect-overrides must be a non-negative safe integer');
}
if (!/^[0-9a-f]{16}$/u.test(expectedAuditId)) {
  throw new Error('--expect-audit-id must be a 16-character lowercase hexadecimal audit id');
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
if (base.attemptedUsers.length !== base.declaredMembers) {
  throw new Error(
    `Base audit attempted-user coverage mismatch: declared=${base.declaredMembers} attempted=${base.attemptedUsers.length}`,
  );
}

const expected = new Set(base.attemptedUsers.map(username => username.toLowerCase()));
for (const result of base.results) {
  if (!expected.has(result.username.toLowerCase())) {
    throw new Error(`Base audit result u/${result.username} was not in the original attempted-user population`);
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
      throw new Error(`Completion log ${file} contains u/${result.username}, outside the original audit population`);
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
      throw new Error(`Corrected overlay contains u/${result.username}, outside the original audit population`);
    }
    if (!final.has(key)) {
      throw new Error(`Corrected overlay targets u/${result.username} before that user's final audit result exists`);
    }
    final.set(key, result);
    overridden.add(key);
  }
}

if (expectedOverrides !== null && overridden.size !== expectedOverrides) {
  throw new Error(`Corrected overlay coverage mismatch: expected=${expectedOverrides} actual=${overridden.size}`);
}
if (final.size !== base.declaredMembers) {
  const missing = base.attemptedUsers.filter(username => !final.has(username.toLowerCase()));
  throw new Error(
    `Audit result set is incomplete: declared=${base.declaredMembers} final-results=${final.size} missing=${missing.length}`,
  );
}

const auditId = sourceHash.digest('hex').slice(0, 16);
if (auditId !== expectedAuditId) {
  throw new Error(`Audit id mismatch: expected=${expectedAuditId} actual=${auditId}`);
}

const validate = (result: MemberAuditResult): void => {
  if (clampReputationPoints(result.afterPoints) !== result.afterPoints) {
    throw new Error(`Audit score for u/${result.username} is outside member reputation bounds`);
  }
  if (result.afterStatus === 'moderator') {
    throw new Error(`Audit result unexpectedly targets moderator u/${result.username}`);
  }
  if (result.afterStatus === 'banned' || result.afterStatus === 'scam') {
    if (result.afterPoints !== REPUTATION_FLOOR) {
      throw new Error(`Permanent status for u/${result.username} does not use the reputation floor`);
    }
    return;
  }
  if (result.afterPoints <= BAN_TRIGGER_POINTS) {
    throw new Error(
      `Non-permanent audit result for u/${result.username} is at or below the ban trigger: `
      + `${result.afterPoints}/${result.afterStatus}`,
    );
  }
};

const results = [...final.values()].sort((a, b) => a.username.localeCompare(b.username));
for (const result of results) validate(result);

const esc = '\u001b[';
const reset = `${esc}0m`;
const bold = `${esc}1m`;
const dim = `${esc}2m`;
const cyan = `${esc}36m`;
const green = `${esc}32m`;
const magenta = `${esc}35m`;
const clear = `${esc}2J${esc}H`;
const altOn = `${esc}?1049h${esc}?25l`;
const altOff = `${esc}?25h${esc}?1049l`;
const tty = process.stdout.isTTY;
let restored = false;

const restore = (): void => {
  if (!tty || restored) return;
  restored = true;
  process.stdout.write(altOff);
};
if (tty) process.stdout.write(altOn);
process.on('exit', restore);
process.once('SIGINT', () => {
  restore();
  process.exit(130);
});
process.once('SIGTERM', () => {
  restore();
  process.exit(143);
});

const plain = (value: string): string => value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/gu, '');
const clip = (value: string, width: number): string => {
  const text = plain(value);
  return text.length <= width ? value : `${text.slice(0, Math.max(0, width - 1))}…`;
};
const pad = (value: string, width: number): string => {
  const clipped = clip(value, width);
  return `${clipped}${' '.repeat(Math.max(0, width - plain(clipped).length))}`;
};
const line = (label: string, value: string, width: number): string => {
  const inner = Math.max(1, width - 4);
  const prefix = label.length === 0 ? '' : `${bold}${label}${reset} `;
  return `│ ${pad(`${prefix}${value}`, inner)} │`;
};
const border = (left: string, fill: string, right: string, width: number): string =>
  `${left}${fill.repeat(Math.max(1, width - 2))}${right}`;
const bar = (done: number, total: number, width: number): string => {
  const cells = Math.max(12, Math.min(50, width));
  const fraction = total === 0 ? 0 : Math.max(0, Math.min(1, done / total));
  const filled = Math.round(cells * fraction);
  return `${green}${'█'.repeat(filled)}${reset}${dim}${'░'.repeat(cells - filled)}${reset} ${(fraction * 100).toFixed(1)}%`;
};

type UiState = {
  phase: string;
  user: string;
  community: string;
  userIndex: number;
  membersDone: number;
  targetsDone: number;
  posted: number;
  deleted: number;
  skipped: number;
  failed: number;
  note: string;
  detail: string;
};

const totalTargets = results.length * communities.length;
const state: UiState = {
  phase: 'Ready',
  user: '',
  community: '',
  userIndex: 0,
  membersDone: 0,
  targetsDone: 0,
  posted: 0,
  deleted: 0,
  skipped: 0,
  failed: 0,
  note: '',
  detail: '',
};

const render = (): void => {
  const width = Math.max(72, Math.min(process.stdout.columns ?? 108, 120));
  const out = [
    border('┌', '─', '┐', width),
    line('', `${magenta}${bold}MAE • APPLY COMPLETED AUDIT TO NATIVE REDDIT MOD NOTES${reset}`, width),
    line('audit', `${auditId}  •  ${results.length} members  •  ${totalTargets} community notes`, width),
    border('├', '─', '┤', width),
    line('phase', `${cyan}${state.phase}${reset}`, width),
    line('progress', bar(state.targetsDone, totalTargets, Math.min(48, width - 28)), width),
    line('members', `${state.membersDone}/${results.length}`, width),
    line('notes', `${state.targetsDone}/${totalTargets} processed  posted=${state.posted} skipped=${state.skipped} failed=${state.failed}`, width),
    line('cleanup', `old native notes deleted=${state.deleted}`, width),
    border('├', '─', '┤', width),
    line('current', state.user.length === 0 ? '—' : `u/${state.user}  (${state.userIndex}/${results.length})`, width),
    line('community', state.community.length === 0 ? '—' : `r/${state.community}`, width),
    line('note', state.note || '—', width),
    line('detail', state.detail || '—', width),
    border('├', '─', '┤', width),
    line('', `${dim}Ctrl-C stops safely. Run the same command again to resume incomplete communities.${reset}`, width),
    border('└', '─', '┘', width),
  ];
  if (tty) process.stdout.write(`${clear}${out.join('\n')}\n`);
  else console.log(`[native-notes] ${state.phase} ${state.targetsDone}/${totalTargets} ${state.user} ${state.community} ${state.detail}`);
};

const notesFile = resolve(
  process.cwd(),
  process.env['REDDIT_MEMBER_MOD_NOTES_FILE']?.trim() || 'data/memberModNotes.pb',
);
const notes = new MemberModNoteStore(notesFile);
await notes.seed(results.map(result => result.username));
const reddit = new MemberModNotesRedditClient(redditConfig().auth);

state.phase = 'Validated completed audit';
state.detail = `Recovered=${completed.size} corrected=${overridden.size}; no audit, LLM, history fetch, or reputation mutation`;
render();

for (let index = 0; index < results.length; index += 1) {
  const result = results[index];
  if (result === undefined) continue;
  state.user = result.username;
  state.userIndex = index + 1;
  state.note = result.note;

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

  const failures: string[] = [];
  for (const community of communities) {
    state.community = community;
    const current = await notes.record(result.username);
    if (current === null) throw new Error(`Member note record disappeared for u/${result.username}`);
    const oldId = current.nativeNotes.find(entry => entry.subreddit === community)?.noteId ?? null;
    const alreadyApplied = same
      && current.appliedTo.some(value => value.toLowerCase() === community)
      && oldId !== null;

    if (alreadyApplied) {
      state.phase = 'Already applied';
      state.skipped += 1;
      state.targetsDone += 1;
      state.detail = `Tracked native note ${oldId}`;
      render();
      continue;
    }

    state.phase = 'Creating native Reddit Mod Note';
    state.detail = oldId === null ? 'No tracked native note to replace' : `Will replace ${oldId}`;
    render();

    try {
      const newId = await reddit.addModNote(community, result.username, result.note, result.label);
      if (oldId !== null && oldId !== newId) {
        state.phase = 'Removing previous native Reddit Mod Note';
        state.detail = `${oldId} → ${newId}`;
        render();
        try {
          await reddit.deleteModNote(community, result.username, oldId);
          state.deleted += 1;
        } catch (deleteError) {
          try {
            await reddit.deleteModNote(community, result.username, newId);
          } catch {
            // The store still points at the old note. Report both remote failures rather than
            // claiming the replacement completed; this exceptional case needs operator review.
          }
          throw new Error(`old-note delete failed after replacement create: ${safeError(deleteError)}`);
        }
      }
      await notes.markNativeNote(result.username, community, newId);
      await notes.markApplied(result.username, community);
      state.posted += 1;
      state.targetsDone += 1;
      state.phase = 'Applied';
      state.detail = `Native note ${newId}`;
      render();
    } catch (error) {
      const failure = `r/${community}: ${safeError(error)}`;
      failures.push(failure);
      state.failed += 1;
      state.targetsDone += 1;
      state.phase = 'Failed';
      state.detail = failure;
      render();
    }
  }

  if (failures.length > 0) await notes.failed(result.username, failures.join(' | '));
  state.membersDone = index + 1;
}

state.community = '';
state.user = '';
state.userIndex = results.length;
state.phase = state.failed === 0 ? 'COMPLETE' : 'COMPLETE WITH FAILURES';
state.detail = state.failed === 0
  ? `All ${totalTargets} native Reddit Mod Note targets are complete or were already applied.`
  : `${state.failed} target(s) failed. Re-run the same command to retry incomplete communities.`;
render();

if (!tty) {
  console.log(
    `COMPLETE audit=${auditId} users=${results.length} posted=${state.posted} deleted=${state.deleted} `
    + `skipped=${state.skipped} failed=${state.failed}`,
  );
}
if (state.failed > 0) process.exitCode = 1;
