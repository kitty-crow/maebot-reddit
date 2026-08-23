import type {
  ModerationHistory,
  ModerationHistoryEntry,
  ModerationRule,
  ModerationVerdict,
} from '../mod/classifier.ts';
import type { ReputationStatus } from './policy.ts';
import { isMap, type Json } from '../types/json.ts';

const text = (value: Json | undefined): string | null =>
  typeof value === 'string' ? value : null;

const integer = (value: Json | undefined, fallback = 0): number =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback;

const verdict = (value: Json | undefined): ModerationVerdict | null =>
  value === 'clean' || value === 'low' || value === 'severe' || value === 'scam' ? value : null;

const rule = (value: Json | undefined): ModerationRule | null =>
  value === 'none'
  || value === 'rule_2'
  || value === 'rule_3'
  || value === 'rule_5'
  || value === 'rule_6'
  || value === 'reddit_site'
  || value === 'other'
    ? value
    : null;

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
  return 'ordinary';
};

export const moderationHistoryFor = (
  raw: Json,
  username: string,
  limit = 12,
): ModerationHistory => {
  if (!isMap(raw)) throw new Error('Reputation history root must be an object');
  const key = username.trim().toLowerCase();
  const users = raw['users'];
  const journal = raw['reputationJournal'];
  if (!isMap(users) || !isMap(journal)) throw new Error('Reputation history maps are missing');

  const user = users[key];
  const currentPoints = isMap(user) ? integer(user['points']) : 0;
  const currentStatus = isMap(user) ? status(user['status']) : 'ordinary';

  const recent: ModerationHistoryEntry[] = [];
  for (const entry of Object.values(journal)) {
    if (!isMap(entry) || entry['kind'] !== 'moderation') continue;
    const entryUsername = text(entry['username']);
    if (entryUsername === null || entryUsername.trim().toLowerCase() !== key) continue;
    const entryVerdict = verdict(entry['verdict']);
    const entryRule = rule(entry['rule']);
    if (entryVerdict === null || entryRule === null || entryVerdict === 'clean') continue;
    recent.push({
      at: integer(entry['at']),
      verdict: entryVerdict,
      rule: entryRule,
      beforePoints: integer(entry['beforePoints']),
      afterPoints: integer(entry['afterPoints']),
    });
  }

  recent.sort((a, b) => b.at - a.at || b.beforePoints - a.beforePoints);
  return {
    currentPoints,
    currentStatus,
    recentViolations: recent.slice(0, Math.max(0, Math.min(50, Math.floor(limit)))),
  };
};
