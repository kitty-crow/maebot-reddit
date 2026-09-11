import { isMap, type Json } from '../types/json.ts';

export type CanonicalNativeUserState = {
  readonly username: string;
  readonly banned: boolean;
  readonly muted: boolean;
};

const text = (value: Json | undefined): string | null => typeof value === 'string' && value.trim().length > 0 ? value : null;
const flag = (value: Json | undefined): boolean => value === true;
const integer = (value: Json | undefined): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null;

export const canonicalNativeUserStates = (raw: Json, nowMs = Date.now()): readonly CanonicalNativeUserState[] => {
  if (!isMap(raw)) throw new Error('Reputation native reconciliation root must be an object');
  const users = raw['users'];
  if (!isMap(users)) throw new Error('Reputation native reconciliation users map is missing');
  const discipline = isMap(raw['discipline']) ? raw['discipline'] : {};
  const out: CanonicalNativeUserState[] = [];

  for (const value of Object.values(users)) {
    if (!isMap(value)) continue;
    const username = text(value['username']);
    if (username === null) continue;
    if (value['status'] === 'moderator' || flag(value['immutableModeratorFlair'])) continue;
    const status = text(value['status']) ?? 'unmapped';
    const banned = status === 'banned' || status === 'scam';
    const record = discipline[username.trim().toLowerCase()];
    let muted = false;
    if (isMap(record)) {
      const until = integer(record['muteUntil']);
      muted = flag(record['mutePermanent']) || (until !== null && until > nowMs);
    }
    out.push({ username, banned, muted });
  }

  return out.sort((a, b) => a.username.localeCompare(b.username));
};
