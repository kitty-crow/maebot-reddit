import type { ReputationStatus } from '../reputation/policy.ts';
import { isMap, type Json } from '../types/json.ts';

export type MemberInventoryRow = {
  readonly username: string;
  readonly points: number;
  readonly status: ReputationStatus;
  readonly moderator: boolean;
};

const integer = (value: Json | undefined): number =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : 0;

const status = (value: Json | undefined): ReputationStatus => {
  if (
    value === 'ordinary'
    || value === 'warned'
    || value === 'uncivil'
    || value === 'banned'
    || value === 'scam'
    || value === 'moderator'
    || value === 'unmapped'
  ) return value;
  return 'unmapped';
};

export const memberInventoryFromReputation = (raw: Json): readonly MemberInventoryRow[] => {
  if (!isMap(raw) || raw['schema'] !== 1) {
    throw new Error('Reputation protobuf does not contain a valid users inventory');
  }
  const users = raw['users'];
  if (!isMap(users)) throw new Error('Reputation protobuf does not contain a valid users inventory');

  const out: MemberInventoryRow[] = [];
  for (const value of Object.values(users)) {
    if (!isMap(value) || typeof value['username'] !== 'string') continue;
    const userStatus = status(value['status']);
    out.push({
      username: value['username'],
      points: integer(value['points']),
      status: userStatus,
      moderator: userStatus === 'moderator' || value['immutableModeratorFlair'] === true,
    });
  }

  return out.sort((a, b) => a.username.localeCompare(b.username));
};
