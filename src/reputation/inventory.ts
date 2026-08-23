import { isMap, type Json } from '../types/json.ts';

const text = (value: Json | undefined): string | null => typeof value === 'string' ? value : null;
const integer = (value: Json | undefined): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null;

const scoreEligibleStatus = (value: Json | undefined): boolean =>
  value === 'ordinary' || value === 'warned' || value === 'uncivil';

export const voteMonitoringExpiresAt = (createdAt: number): number => {
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
    throw new Error('Contribution creation timestamp must be a non-negative safe integer');
  }
  const date = new Date(createdAt * 1_000);
  date.setUTCMonth(date.getUTCMonth() + 6);
  return Math.floor(date.getTime() / 1_000);
};

export const scoreInventoryFullnames = (
  raw: Json,
  now = Math.floor(Date.now() / 1_000),
): readonly string[] => {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Inventory timestamp must be a non-negative safe integer');
  if (!isMap(raw)) throw new Error('Reputation inventory root must be an object');
  const contributions = raw['contributions'];
  const users = raw['users'];
  if (!isMap(contributions) || !isMap(users)) throw new Error('Reputation inventory maps are missing');

  const fullnames: string[] = [];
  for (const contribution of Object.values(contributions)) {
    if (!isMap(contribution) || contribution['exempt'] === true) continue;
    if (contribution['verdict'] !== 'clean') continue;
    if (contribution['archived'] === true || contribution['voteCreditDisabled'] === true) continue;
    const fullname = text(contribution['fullname']);
    const author = text(contribution['author']);
    const createdAt = integer(contribution['createdAt']);
    if (fullname === null || author === null || createdAt === null) continue;
    if (now >= voteMonitoringExpiresAt(createdAt)) continue;
    if (!/^(?:t1|t3)_[A-Za-z0-9]+$/u.test(fullname)) continue;
    const user = users[author.trim().toLowerCase()];
    if (!isMap(user) || !scoreEligibleStatus(user['status'])) continue;
    fullnames.push(fullname);
  }
  return fullnames.sort((a, b) => a.localeCompare(b));
};
