import type { ReputationStatus } from '../reputation/policy.ts';
import type { MemberModNoteLabel } from './store.ts';

export type MemberAuditResult = {
  readonly username: string;
  readonly beforePoints: number;
  readonly afterPoints: number;
  readonly beforeStatus: ReputationStatus;
  readonly afterStatus: ReputationStatus;
  readonly summary: string;
  readonly label: MemberModNoteLabel;
  readonly note: string;
};

export type ParsedMemberAudit = {
  readonly declaredMembers: number | null;
  readonly attemptedUsers: readonly string[];
  readonly results: readonly MemberAuditResult[];
  readonly duplicateUsers: readonly string[];
};

const labels = new Set<MemberModNoteLabel>([
  'NONE',
  'HELPFUL_USER',
  'SOLID_CONTRIBUTOR',
  'SPAM_WATCH',
  'SPAM_WARNING',
  'ABUSE_WARNING',
]);

const statuses = new Set<ReputationStatus>([
  'ordinary',
  'warned',
  'uncivil',
  'banned',
  'scam',
  'moderator',
  'unmapped',
]);

const integer = (raw: string, field: string): number => {
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`Member audit ${field} is not a safe integer: ${raw}`);
  return value;
};

const status = (raw: string, field: string): ReputationStatus => {
  const value = raw.trim() as ReputationStatus;
  if (!statuses.has(value)) throw new Error(`Member audit ${field} is invalid: ${raw}`);
  return value;
};

const label = (raw: string): MemberModNoteLabel => {
  const value = raw.trim() as MemberModNoteLabel;
  if (!labels.has(value)) throw new Error(`Member audit label is invalid: ${raw}`);
  return value;
};

const attemptedUsersFrom = (lines: readonly string[]): readonly string[] => {
  const users = new Map<string, string>();
  for (const line of lines) {
    const match = /CURRENT USER\s+\d+\/\d+:\s+u\/([A-Za-z0-9_-]{1,32})\s*$/u.exec(line);
    const username = match?.[1];
    if (username === undefined) continue;
    const key = username.toLowerCase();
    if (!users.has(key)) users.set(key, username);
  }
  return [...users.values()].sort((a, b) => a.localeCompare(b));
};

export const parseMemberAuditLog = (raw: string): ParsedMemberAudit => {
  const lines = raw.split(/\r?\n/u);
  const declared = lines
    .map(line => /^Members:\s*(\d+)\s*$/u.exec(line)?.[1] ?? null)
    .find(value => value !== null);
  const declaredMembers = declared === undefined || declared === null
    ? null
    : integer(declared, 'member count');

  const records = new Map<string, MemberAuditResult>();
  const duplicates = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const header = /^USER RESULT\s+\d+\/\d+:\s+u\/([A-Za-z0-9_-]{1,32})\s*$/u.exec(lines[index] ?? '');
    if (header === null) continue;
    const username = header[1];
    if (username === undefined) continue;

    let summary: string | null = null;
    let beforePoints: number | null = null;
    let afterPoints: number | null = null;
    let beforeStatus: ReputationStatus | null = null;
    let afterStatus: ReputationStatus | null = null;
    let selectedLabel: MemberModNoteLabel | null = null;
    let note: string | null = null;

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor] ?? '';
      if (/^USER RESULT\s+/u.test(line) || /^-{20,}\s*$/u.test(line)) break;
      if (line.startsWith('Notes: ')) summary = line.slice('Notes: '.length).trim();

      const score = /^Score:\s*(-?\d+)\s*->\s*(-?\d+)\s*$/u.exec(line);
      if (score !== null && score[1] !== undefined && score[2] !== undefined) {
        beforePoints = integer(score[1], 'before score');
        afterPoints = integer(score[2], 'after score');
      }

      const state = /^Status:\s*([a-z]+)\s*->\s*([a-z]+)\s*$/u.exec(line);
      if (state !== null && state[1] !== undefined && state[2] !== undefined) {
        beforeStatus = status(state[1], 'before status');
        afterStatus = status(state[2], 'after status');
      }

      const tag = /^Tag:\s+.*\((NONE|HELPFUL_USER|SOLID_CONTRIBUTOR|SPAM_WATCH|SPAM_WARNING|ABUSE_WARNING)\)\s*$/u.exec(line);
      if (tag !== null && tag[1] !== undefined) selectedLabel = label(tag[1]);
      if (line.startsWith('Mod Note: ')) note = line.slice('Mod Note: '.length).trim();
    }

    if (
      summary === null
      || beforePoints === null
      || afterPoints === null
      || beforeStatus === null
      || afterStatus === null
      || selectedLabel === null
      || note === null
    ) {
      throw new Error(`Incomplete USER RESULT block for u/${username}`);
    }
    if (note.length === 0 || note.length > 250) {
      throw new Error(`Member audit Mod Note for u/${username} must be from 1 to 250 characters`);
    }
    const expectedPrefix = `Mae score: ${afterPoints}. `;
    if (!note.startsWith(expectedPrefix)) {
      throw new Error(`Member audit Mod Note score does not match final score for u/${username}`);
    }

    const key = username.toLowerCase();
    if (records.has(key)) duplicates.add(username);
    records.set(key, {
      username,
      beforePoints,
      afterPoints,
      beforeStatus,
      afterStatus,
      summary,
      label: selectedLabel,
      note,
    });
  }

  return {
    declaredMembers,
    attemptedUsers: attemptedUsersFrom(lines),
    results: [...records.values()].sort((a, b) => a.username.localeCompare(b.username)),
    duplicateUsers: [...duplicates].sort((a, b) => a.localeCompare(b)),
  };
};
