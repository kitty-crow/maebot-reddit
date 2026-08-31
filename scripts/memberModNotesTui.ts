import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const args = process.argv.slice(2);
const runArg = args.find(arg => arg.startsWith('--run='));
if (runArg === undefined) throw new Error('Usage: --run=<member-notes-run-directory>');
const runDir = resolve(process.cwd(), runArg.slice('--run='.length));
const logFile = resolve(runDir, 'member-mod-notes.log');
const failedFile = resolve(runDir, 'failed.txt');
const manifestFile = resolve(runDir, 'manifest.txt');

const esc = '\u001b[';
const reset = `${esc}0m`;
const bold = `${esc}1m`;
const dim = `${esc}2m`;
const cyan = `${esc}36m`;
const green = `${esc}32m`;
const yellow = `${esc}33m`;
const red = `${esc}31m`;
const magenta = `${esc}35m`;
const blue = `${esc}34m`;
const clear = `${esc}2J${esc}H`;
const altOn = `${esc}?1049h${esc}?25l`;
const altOff = `${esc}?25h${esc}?1049l`;

const visibleLength = (value: string): number => value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/gu, '').length;
const clip = (value: string, width: number): string => {
  if (width <= 1) return '';
  const plain = value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/gu, '');
  if (plain.length <= width) return value;
  return `${plain.slice(0, Math.max(0, width - 1))}…`;
};
const pad = (value: string, width: number): string => `${value}${' '.repeat(Math.max(0, width - visibleLength(value)))}`;
const boxLine = (title: string, value: string, width: number): string => {
  const inner = Math.max(1, width - 4);
  const label = title.length > 0 ? `${bold}${title}${reset} ` : '';
  return `│ ${pad(clip(`${label}${value}`, inner), inner)} │`;
};
const separator = (width: number): string => `├${'─'.repeat(Math.max(1, width - 2))}┤`;
const top = (width: number): string => `┌${'─'.repeat(Math.max(1, width - 2))}┐`;
const bottom = (width: number): string => `└${'─'.repeat(Math.max(1, width - 2))}┘`;

const manifest = new Map<string, string>();
if (existsSync(manifestFile)) {
  for (const line of (await readFile(manifestFile, 'utf8')).split(/\r?\n/u)) {
    const at = line.indexOf('=');
    if (at > 0) manifest.set(line.slice(0, at), line.slice(at + 1));
  }
}
const declared = Number(manifest.get('candidate_count') ?? '0');

const progressBar = (done: number, total: number, width: number): string => {
  const safeTotal = Math.max(1, total);
  const fraction = Math.max(0, Math.min(1, done / safeTotal));
  const cells = Math.max(8, Math.min(48, width));
  const filled = Math.round(cells * fraction);
  return `${green}${'█'.repeat(filled)}${reset}${dim}${'░'.repeat(cells - filled)}${reset} ${(fraction * 100).toFixed(1)}%`;
};

type View = {
  readonly userIndex: number;
  readonly userTotal: number;
  readonly username: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly commentIndex: number;
  readonly commentTotal: number;
  readonly comment: string;
  readonly notes: string;
  readonly score: string;
  readonly status: string;
  readonly decision: string;
  readonly completed: number;
  readonly failures: number;
  readonly fallback: boolean;
  readonly phase: string;
  readonly complete: boolean;
};

const parse = (raw: string, failedCount: number): View => {
  const lines = raw.split(/\r?\n/u);
  let userIndex = 0;
  let userTotal = declared;
  let username = '';
  let attempt = 0;
  let maxAttempts = 0;
  let commentIndex = 0;
  let commentTotal = 0;
  let comment = '';
  let notes = '';
  let score = '';
  let status = '';
  let decision = '';
  let fallback = false;
  let phase = 'Waiting for worker output';
  let complete = false;
  const completedUsers = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const user = /^MISSING USER (\d+)\/(\d+): u\/([^ ]+) — attempt (\d+)\/(\d+)$/u.exec(line);
    if (user !== null) {
      userIndex = Number(user[1]);
      userTotal = Number(user[2]);
      username = user[3] ?? '';
      attempt = Number(user[4]);
      maxAttempts = Number(user[5]);
      commentIndex = 0;
      commentTotal = 0;
      comment = '';
      notes = '';
      score = '';
      status = '';
      decision = '';
      fallback = false;
      phase = 'Fetching Reddit history';
      continue;
    }
    const snapshot = /^SNAPSHOT FALLBACK: u\/([^ ]+)/u.exec(line);
    if (snapshot !== null) {
      username = snapshot[1] ?? username;
      fallback = true;
      phase = 'Assessing persisted snapshot history';
      continue;
    }
    const checking = /^Checking comment (\d+)\/(\d+) with Mae/u.exec(line);
    if (checking !== null) {
      commentIndex = Number(checking[1]);
      commentTotal = Number(checking[2]);
      phase = 'Mae is classifying';
      continue;
    }
    const persisted = /^Persisted comment (\d+)\/(\d+):/u.exec(line);
    if (persisted !== null) {
      commentIndex = Number(persisted[1]);
      commentTotal = Number(persisted[2]);
      fallback = true;
      phase = 'Mae is classifying persisted context';
      continue;
    }
    if (line.startsWith('Comment: ')) comment = line.slice(9).trim();
    if (line.startsWith('Notes: ')) notes = line.slice(7).trim();
    if (line.startsWith('Score: ')) score = line.slice(7).trim();
    if (line.startsWith('Status: ')) status = line.slice(8).trim();
    if (line.startsWith('Decision: ')) decision = line.slice(10).trim();
    const result = /^USER RESULT \d+\/\d+: u\/([^ ]+)$/u.exec(line);
    if (result !== null && result[1] !== undefined) {
      completedUsers.add(result[1].toLowerCase());
      phase = 'Member result complete';
    }
    if (line.includes('MISSING AUDIT COMPLETION COMPLETE')) {
      complete = true;
      phase = 'Audit completion finished';
    }
    if (line.includes('MISSING AUDIT COMPLETION FINISHED WITH FAILURES')) {
      complete = true;
      phase = 'Audit completion finished with unresolved users';
    }
  }

  return {
    userIndex,
    userTotal,
    username,
    attempt,
    maxAttempts,
    commentIndex,
    commentTotal,
    comment,
    notes,
    score,
    status,
    decision,
    completed: completedUsers.size,
    failures: failedCount,
    fallback,
    phase,
    complete,
  };
};

let quit = false;
const tty = process.stdin.isTTY && process.stdout.isTTY;
const restore = (): void => {
  if (tty) {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write(altOff);
  }
};

if (tty) {
  process.stdout.write(altOn);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', key => {
    if (key === 'q' || key === 'Q' || key === '\u0003' || key === '\u001b') quit = true;
  });
}

process.on('exit', restore);
process.on('SIGTERM', () => { quit = true; });
process.on('SIGHUP', () => { quit = true; });

while (!quit) {
  const raw = existsSync(logFile) ? await readFile(logFile, 'utf8') : '';
  const failures = existsSync(failedFile)
    ? (await readFile(failedFile, 'utf8')).split(/\r?\n/u).filter(Boolean).length
    : 0;
  const view = parse(raw, failures);
  const width = Math.max(62, Math.min(process.stdout.columns ?? 100, 120));
  const total = view.userTotal > 0 ? view.userTotal : declared;
  const currentDone = Math.max(view.completed, Math.max(0, view.userIndex - 1));
  const lines: string[] = [];
  lines.push(top(width));
  lines.push(boxLine('', `${magenta}${bold}MAE • MEMBER MOD NOTES AUDIT${reset}`, width));
  lines.push(boxLine('run', basename(runDir), width));
  lines.push(separator(width));
  lines.push(boxLine('phase', `${cyan}${view.phase}${reset}`, width));
  lines.push(boxLine('overall', progressBar(currentDone, total, Math.min(44, width - 30)), width));
  lines.push(boxLine('members', `${view.completed}/${total} final results   ${red}${view.failures} unresolved${reset}`, width));
  lines.push(separator(width));
  lines.push(boxLine('current', view.username.length > 0 ? `u/${view.username}  (${view.userIndex}/${total})` : 'waiting…', width));
  lines.push(boxLine('source', view.fallback ? `${yellow}persisted reputation snapshot${reset}` : `${blue}Reddit history${reset}`, width));
  lines.push(boxLine('attempt', view.attempt > 0 ? `${view.attempt}/${view.maxAttempts}` : '—', width));
  lines.push(boxLine('item', view.commentTotal > 0 ? `${view.commentIndex}/${view.commentTotal}` : '—', width));
  lines.push(separator(width));
  lines.push(boxLine('comment', view.comment || '—', width));
  lines.push(boxLine('Mae', view.notes || '—', width));
  lines.push(boxLine('score', view.score || '—', width));
  lines.push(boxLine('status', view.status || '—', width));
  lines.push(boxLine('decision', view.decision || '—', width));
  lines.push(separator(width));
  lines.push(boxLine('', view.complete
    ? `${green}${bold}Finished.${reset} Press q to leave.`
    : `${dim}q / Esc: leave dashboard • worker continues in tmux${reset}`, width));
  lines.push(bottom(width));

  if (tty) process.stdout.write(`${clear}${lines.join('\n')}\n`);
  else {
    process.stdout.write(`${lines.join('\n')}\n`);
    break;
  }
  await Bun.sleep(250);
}

restore();
