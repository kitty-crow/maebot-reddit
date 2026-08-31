import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MemberModNoteStore, type MemberModNoteRecord } from '../src/modnotes/store.ts';

const communities = ['catgirlcoin', 'nyaonearth'] as const;
const args = process.argv.slice(2);
const logArg = args.find(arg => arg.startsWith('--log='));
const notesArg = args.find(arg => arg.startsWith('--notes='));
const auditArg = args.find(arg => arg.startsWith('--audit-id='));
const totalArg = args.find(arg => arg.startsWith('--total='));
if (logArg === undefined || notesArg === undefined || auditArg === undefined || totalArg === undefined) {
  throw new Error('Usage: --log=<worker.log> --notes=<memberModNotes.pb> --audit-id=<id> --total=<members>');
}

const logFile = resolve(process.cwd(), logArg.slice('--log='.length));
const notesFile = resolve(process.cwd(), notesArg.slice('--notes='.length));
const auditId = auditArg.slice('--audit-id='.length).trim();
const totalMembers = Number(totalArg.slice('--total='.length));
if (!/^[0-9a-f]{16}$/u.test(auditId)) throw new Error('--audit-id must be a 16-character lowercase hexadecimal id');
if (!Number.isSafeInteger(totalMembers) || totalMembers < 1) throw new Error('--total must be a positive integer');

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

const applied = (record: MemberModNoteRecord, community: string): boolean => {
  const key = community.toLowerCase();
  return record.appliedTo.some(value => value.toLowerCase() === key)
    && record.nativeNotes.some(value => value.subreddit.toLowerCase() === key);
};

const trackedId = (record: MemberModNoteRecord, community: string): string | null =>
  record.nativeNotes.find(value => value.subreddit.toLowerCase() === community.toLowerCase())?.noteId ?? null;

type WorkerView = {
  readonly phase: string;
  readonly username: string;
  readonly community: string;
  readonly detail: string;
  readonly targetDone: number;
  readonly targetTotal: number;
};

const parseWorker = (raw: string): WorkerView => {
  let phase = 'Waiting for worker output';
  let username = '';
  let community = '';
  let detail = '';
  let targetDone = 0;
  let targetTotal = totalMembers * communities.length;

  for (const line of raw.split(/\r?\n/u)) {
    if (!line.startsWith('[native-notes] ')) continue;
    const body = line.slice('[native-notes] '.length);
    const ratio = /\b(\d+)\/(\d+)\b/u.exec(body);
    if (ratio === null || ratio[1] === undefined || ratio[2] === undefined) continue;
    targetDone = Number(ratio[1]);
    targetTotal = Number(ratio[2]);
    phase = body.slice(0, ratio.index).trim() || phase;

    const afterRatio = body.slice(ratio.index + ratio[0].length).trim();
    const target = /^([A-Za-z0-9_-]{1,32})\s+(catgirlcoin|nyaonearth)(?:\s+(.*))?$/u.exec(afterRatio);
    if (target !== null) {
      username = target[1] ?? username;
      community = target[2] ?? community;
      detail = target[3]?.trim() ?? '';
    } else if (afterRatio.length > 0) {
      detail = afterRatio;
      if (phase.startsWith('COMPLETE')) {
        username = '';
        community = '';
      }
    }
  }

  return { phase, username, community, detail, targetDone, targetTotal };
};

const notes = new MemberModNoteStore(notesFile);
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
  const records = existsSync(notesFile) ? await notes.records() : [];
  const totalTargets = totalMembers * communities.length;
  const appliedTargets = records.reduce(
    (sum, record) => sum + communities.filter(community => applied(record, community)).length,
    0,
  );
  const completedMembers = records.filter(record => communities.every(community => applied(record, community))).length;
  const failedMembers = records.filter(record => record.error !== null).length;

  let current = worker.username.length > 0
    ? records.find(record => record.username.toLowerCase() === worker.username.toLowerCase()) ?? null
    : null;
  if (current === null) {
    current = records.find(record => !communities.every(community => applied(record, community))) ?? null;
  }

  const currentCommunity = worker.community.length > 0
    ? worker.community
    : current === null
      ? ''
      : communities.find(community => !applied(current, community)) ?? '';
  const currentIndex = current === null
    ? 0
    : Math.max(1, records.findIndex(record => record.username.toLowerCase() === current.username.toLowerCase()) + 1);
  const targetIndex = currentCommunity === 'catgirlcoin' ? 1 : currentCommunity === 'nyaonearth' ? 2 : 0;
  const note = current?.note ?? '';
  const tag = current?.label ?? '';
  const nativeId = current === null || currentCommunity.length === 0 ? null : trackedId(current, currentCommunity);
  const result = current?.error !== null && current?.error !== undefined
    ? `${red}${current.error}${reset}`
    : nativeId !== null
      ? `${green}applied • ${nativeId}${reset}`
      : `${yellow}${worker.phase.startsWith('COMPLETE') ? 'finished' : 'pending'}${reset}`;
  const complete = appliedTargets >= totalTargets && failedMembers === 0;

  const width = Math.max(62, Math.min(process.stdout.columns ?? 100, 120));
  const lines: string[] = [];
  lines.push(top(width));
  lines.push(boxLine('', `${magenta}${bold}MAE • MEMBER MOD NOTES APPLY${reset}`, width));
  lines.push(boxLine('audit', auditId, width));
  lines.push(separator(width));
  lines.push(boxLine('phase', `${cyan}${worker.phase}${reset}`, width));
  lines.push(boxLine('overall', progressBar(appliedTargets, totalTargets, Math.min(44, width - 30)), width));
  lines.push(boxLine('members', `${completedMembers}/${totalMembers} complete   ${red}${failedMembers} failed${reset}`, width));
  lines.push(separator(width));
  lines.push(boxLine('current', current === null ? 'waiting…' : `u/${current.username}  (${currentIndex}/${totalMembers})`, width));
  lines.push(boxLine('source', `${blue}completed 990-member audit${reset}`, width));
  lines.push(boxLine('target', currentCommunity.length > 0 ? `r/${currentCommunity}  (${targetIndex}/2)` : '—', width));
  lines.push(boxLine('notes', `${appliedTargets}/${totalTargets} native Mod Notes applied`, width));
  lines.push(separator(width));
  lines.push(boxLine('Mod Note', note || '—', width));
  lines.push(boxLine('tag', tag || '—', width));
  lines.push(boxLine('result', result, width));
  lines.push(boxLine('detail', worker.detail || '—', width));
  lines.push(separator(width));
  lines.push(boxLine('', complete
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
