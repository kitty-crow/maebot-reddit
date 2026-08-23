import { isMap, type Json } from '../types/json.ts';

const text = (value: Json | undefined): string | null => typeof value === 'string' ? value : null;

const scoreEligibleStatus = (value: Json | undefined): boolean =>
  value === 'ordinary' || value === 'warned' || value === 'uncivil';

export const scoreInventoryFullnames = (raw: Json): readonly string[] => {
  if (!isMap(raw)) throw new Error('Reputation inventory root must be an object');
  const contributions = raw['contributions'];
  const users = raw['users'];
  if (!isMap(contributions) || !isMap(users)) throw new Error('Reputation inventory maps are missing');

  const fullnames: string[] = [];
  for (const contribution of Object.values(contributions)) {
    if (!isMap(contribution) || contribution['exempt'] === true) continue;
    if (contribution['verdict'] !== 'clean') continue;
    const fullname = text(contribution['fullname']);
    const author = text(contribution['author']);
    if (fullname === null || author === null) continue;
    if (!/^(?:t1|t3)_[A-Za-z0-9]+$/u.test(fullname)) continue;
    const user = users[author.trim().toLowerCase()];
    if (!isMap(user) || !scoreEligibleStatus(user['status'])) continue;
    fullnames.push(fullname);
  }
  return fullnames.sort((a, b) => a.localeCompare(b));
};
