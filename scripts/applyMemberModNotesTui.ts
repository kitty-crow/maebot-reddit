import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseMemberAuditLog, type MemberAuditResult } from '../src/modnotes/auditResults.ts';

const communities = ['catgirlcoin', 'nyaonearth'] as const;
const args = process.argv.slice(2);
const logArg = args.find(arg => arg.startsWith('--log='));
const auditArg = args.find(arg => arg.startsWith('--audit-id='));
const totalArg = args.find(arg => arg.startsWith('--total='));
const baseArg = args.find(arg => arg.startsWith('--base='));
const completionArgs = args.filter(arg => arg.startsWith('--completion='));
const overlayArgs = args.filter(arg => arg.startsWith('--overlay='));
if (logArg === undefined || auditArg === undefined || totalArg === undefined || baseArg === undefined) {
  throw new Error(
    'Usage: --log=<worker.log> --audit-id=<id> --total=<members> --base=<audit.log> '
    + '[--completion=<log> ...] [--overlay=<log> ...]',
  );
}

const logFile = resolve(process.cwd(), logArg.slice('--log='.length));
const auditId = auditArg.slice('--audit-id='.length).trim();
const totalMembers = Number(totalArg.slice('--total='.length));
const baseFile = resolve(process.cwd(), baseArg.slice('--base='.length));
const completionFiles = completionArgs.map(arg => resolve(process.cwd(), arg.slice('--completion='.length)));
const overlayFiles = overlayArgs.map(arg => resolve(process.cwd(), arg.slice('--overlay='.length)));
if (!/^[0-9a-f]{16}$/u.test(auditId)) throw new Error('--audit-id must be a 16-character lowercase hexadecimal id');
if (!Number.isSafeInteger(totalMembers) || totalMembers < 1) throw new Error('--total must be a positive integer');

const base = parseMemberAuditLog(await readFile(baseFile, 'utf8'));
const final = new Map(base.results.map(result => [result.username.toLowerCase(), result]));
for (const file of completionFiles) {
  const parsed = parseMemberAuditLog(await readFile(file, 'utf8'));
  for (const result of parsed.results) final.set(result.username.toLowerCase(), result);
}
for (const file of overlayFiles) {
  const parsed = parseMemberAuditLog(await readFile(file, 'utf8'));
  for (const result of parsed.results) final.set(result.username.toLowerCase(), result);
}
if (final.size !== totalMembers) {
  throw new Error(`Dashboard audit coverage mismatch: expected=${totalMembers} actual=${final.size}`);
}
const results = [...final.values()].sort((a, b) => a.username.localeCompare(b.username));
const resultByUser = new Map(results.map(result => [result.username.toLowerCase(), result]));

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
const progressBar = (done: number, total: number, width: number): string => {
  const safeTotal = Math.max(1, total);
  const fraction = Math.max(0, Math.min(1, done / safeTotal));
  const cells = Math.max(8, Math.min(48, width));
  const filled = Math.round(cells * fraction);
  return `${green}${'█'.repeat(filled)}${reset}${dim}${'░'.repeat(cells - filled)}${reset} ${(fraction * 100).toFixed(1)}%`;
};

type FinalState = 'applied' | 'skipped' | 'failed';
type WorkerView = {
  readonly phase: string;
  readonly username: string;
  readonly community: string;
  readonly detail: string;
  readonly targetDone: number;
  readonly targetTotal: number;
  readonly posted: number;
  readonly skipped: number;
  readonly failed: number;
  readonly completedMembers: number;
  readonly complete: boolean;
};

const parseWorker = (raw: string): WorkerView => {
  let phase = 'Waiting for worker output';
  let username = '';
  let community = '';
  let detail = '';
  let targetDone = 0;
  let targetTotal = totalMembers * communities.length;
  const finals = new Map<string, FinalState>();

  for (const line of raw.split(/\r?\n/u)) {
    if (!line.startsWith('[native-notes] ')) continue;
    const body = line.slice('[native-notes] '.length);
    const ratio = /\b(\d+)\/(\d+)\b/u.exec(body);
    if (ratio === null || ratio[1] === undefined || ratio[2] === undefined) continue;

    const parsedPhase = body.slice(0, ratio.index).trim();
    const parsedDone = Number(ratio[1]);
    const parsedTotal = Number(ratio[2]);
    const afterRatio = body.slice(ratio.index + ratio[0].length).trim();
    const target = /^([A-Za-z0-9_-]{1,32})\s+(catgirlcoin|nyaonearth)(?:\s+(.*))?$/u.exec(afterRatio);

    phase = parsedPhase || phase;
    targetDone = parsedDone;
    targetTotal = parsedTotal;
    if (target !== null) {
      username = target[1] ?? username;
      community = target[2] ?? community;
      detail = target[3]?.trim() ?? '';
      const key = `${username.toLowerCase()}|${community}`;
      if (phase === 'Applied') finals.set(key, 'applied');
      if (phase === 'Already applied') finals.set(key, 'skipped');
      if (phase === 'Failed') finals.set(key, 'failed');
    } else {
      detail = afterRatio;
      if (phase.startsWith('COMPLETE')) {
        username = '';
        community = '';
      }
    }
  }

  let posted = 0;
  let skipped = 0;
  let failed = 0;
  for (const state of finals.values()) {
    if (state === 'applied') posted += 1;
    if (state === 'skipped') skipped += 1;
    if (state === 'failed') failed += 1;
  }

  const completedMembers = results.filter(result =>
    communities.every(communityName => {
      const status = finals.get(`${result.username.toLowerCase()}|${communityName}`);
      return status === 'applied' || status === 'skipped';
    }),
  ).length;

  return {
    phase,
    username,
    community,
    detail,
    targetDone,
    targetTotal,
    posted,
    skipped,
    failed,
    completedMembers,
    complete: phase.startsWith('COMPLETE'),
  };
};

const auditResult = (username: string): MemberAuditResult | null =>
  username.length === 0 ? null : resultByUser.get(username.toLowerCase()) ?? null;

let quit = false;
const tty = process.stdin.isTTY && process.stdout.isTTY;
const restore = (): void => {
  if (!tty) return;
  process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdout.write(altOff);
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
  const worker = parseWorker(raw);
  const current = auditResult(worker.username);
  const currentIndex = current === null
    ? 0
    : Math.max(1, results.findIndex(result => result.username.toLowerCase() === current.username.toLowerCase()) + 1);
  const targetIndex = worker.community === 'catgirlcoin' ? 1 : worker.community === 'nyaonearth' ? 2 : 0;
  const successfulTargets = worker.posted + worker.skipped;
  const result = worker.phase === 'Failed'
    ? `${red}${worker.detail || 'failed'}${reset}`
    : worker.phase === 'Applied'
      ? `${green}${worker.detail || 'applied'}${reset}`
      : worker.phase === 'Already applied'
        ? `${yellow}${worker.detail || 'already applied'}${reset}`
        : worker.detail || '—';

  const width = Math.max(62, Math.min(process.stdout.columns ?? 100, 120));
  const lines: string[] = [];
  lines.push(top(width));
  lines.push(boxLine('', `${magenta}${bold}MAE • MEMBER MOD NOTES APPLY${reset}`, width));
  lines.push(boxLine('audit', auditId, width));
  lines.push(separator(width));
  lines.push(boxLine('phase', `${cyan}${worker.phase}${reset}`, width));
  lines.push(boxLine('overall', progressBar(worker.targetDone, worker.targetTotal, Math.min(44, width - 30)), width));
  lines.push(boxLine(
    'members',
    `${worker.completedMembers}/${totalMembers} complete   ${red}${worker.failed} failed targets${reset}`,
    width,
  ));
  lines.push(separator(width));
  lines.push(boxLine('current', current === null ? 'waiting…' : `u/${current.username}  (${currentIndex}/${totalMembers})`, width));
  lines.push(boxLine('source', `${blue}completed ${totalMembers}-member audit${reset}`, width));
  lines.push(boxLine('target', worker.community.length > 0 ? `r/${worker.community}  (${targetIndex}/2)` : '—', width));
  lines.push(boxLine(
    'notes',
    `${successfulTargets}/${worker.targetTotal} satisfied   posted=${worker.posted} skipped=${worker.skipped} failed=${worker.failed}`,
    width,
  ));
  lines.push(separator(width));
  lines.push(boxLine('Mod Note', current?.note ?? '—', width));
  lines.push(boxLine('tag', current?.label ?? '—', width));
  lines.push(boxLine('result', result, width));
  lines.push(boxLine('detail', worker.detail || '—', width));
  lines.push(separator(width));
  lines.push(boxLine('', worker.complete
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
