const digits: Readonly<Record<string, string>> = {
  '0': '0️⃣',
  '1': '1️⃣',
  '2': '2️⃣',
  '3': '3️⃣',
  '4': '4️⃣',
  '5': '5️⃣',
  '6': '6️⃣',
  '7': '7️⃣',
  '8': '8️⃣',
  '9': '9️⃣',
};

export const numberEmoji = (value: number): string => String(Math.max(0, Math.floor(value)))
  .split('')
  .map(char => digits[char] ?? char)
  .join('');

export type LeaderboardRow = {
  readonly user: string;
  readonly score: number;
  readonly at: number;
};

export const bumpLeaderboard = (
  rows: readonly LeaderboardRow[],
  user: string,
  at: number,
): readonly LeaderboardRow[] => {
  const found = rows.find(row => row.user === user);
  const next = found === undefined
    ? [...rows, { user, score: 1, at }]
    : rows.map(row => row.user === user ? { ...row, score: row.score + 1, at } : row);
  return [...next].sort((a, b) => b.score - a.score || a.at - b.at || a.user.localeCompare(b.user));
};

export const publicMaeReplyDue = (lastPosted: number, now: number, cooldownSec = 43_200): boolean =>
  lastPosted < now - cooldownSec;
