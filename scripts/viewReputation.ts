import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { rankReputationRows, type ReputationRankingRow } from '../src/reputation/ranking.ts';
import { parseMap } from '../src/types/json.ts';
import { arrVal, boolVal, mapVal, numVal, optStr, strVal } from '../src/types/value.ts';

const valueArg = (prefix: string): string | null => {
  const value = process.argv.find(arg => arg.startsWith(`${prefix}=`));
  return value === undefined ? null : value.slice(prefix.length + 1).trim();
};

const reportPath = resolve(process.cwd(), valueArg('--report') ?? 'data/reputation-bootstrap-report.json');
const rawPageSize = valueArg('--page-size');
const pageSize = rawPageSize === null ? 10 : Number(rawPageSize);

if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
  throw new Error('--page-size must be an integer from 1 to 100');
}

const report = parseMap(await readFile(reportPath, 'utf8'));
const userValues = arrVal(report['users'], 'report.users');
const validTiers = new Set([0, 1, 2, 3, 4, 5, 9]);
const rows: ReputationRankingRow[] = userValues.map((value, index): ReputationRankingRow => {
  const row = mapVal(value, `report.users[${index}]`);
  const tier = numVal(row['tier'], `report.users[${index}].tier`);
  if (!Number.isSafeInteger(tier) || !validTiers.has(tier)) {
    throw new Error(`report.users[${index}].tier must be one of 0, 1, 2, 3, 4, 5 or 9`);
  }
  return {
    username: strVal(row['username'], `report.users[${index}].username`),
    points: numVal(row['points'], `report.users[${index}].points`),
    tier,
    status: strVal(row['status'], `report.users[${index}].status`),
    currentFlairText: optStr(row['currentFlairText']),
    immutableModeratorFlair: boolVal(
      row['immutableModeratorFlair'],
      `report.users[${index}].immutableModeratorFlair`,
    ),
  };
});

const ranked = rankReputationRows(rows);
const width = (values: readonly string[], floor: number, ceiling: number): number =>
  Math.max(floor, Math.min(ceiling, ...values.map(value => value.length)));
const userWidth = width(ranked.map(row => `u/${row.username}`), 12, 32);
const flairWidth = width(ranked.map(row => row.currentFlairText ?? '(none)'), 14, 32);
const clamp = (value: string, size: number): string => value.length <= size
  ? value.padEnd(size)
  : `${value.slice(0, Math.max(0, size - 1))}…`;

const printHeader = (start: number, end: number): void => {
  console.log(`\nMae reputation ranking ${start + 1}-${end} of ${ranked.length}`);
  console.log(
    `${'#'.padStart(4)}  ${'User'.padEnd(userWidth)}  ${'Score'.padStart(12)}  ${'Tier'.padStart(4)}  ${'Current flair'.padEnd(flairWidth)}  Status`,
  );
  console.log('-'.repeat(Math.min(130, 4 + 2 + userWidth + 2 + 12 + 2 + 4 + 2 + flairWidth + 2 + 16)));
};

const rl = createInterface({ input: stdin, output: stdout });
try {
  for (let start = 0; start < ranked.length; start += pageSize) {
    const end = Math.min(start + pageSize, ranked.length);
    printHeader(start, end);
    for (let index = start; index < end; index += 1) {
      const row = ranked[index];
      if (row === undefined) throw new Error(`Ranking row ${index} disappeared`);
      const marker = row.immutableModeratorFlair ? 'MOD' : String(index + 1);
      const user = clamp(`u/${row.username}`, userWidth);
      const flair = clamp(row.currentFlairText ?? '(none)', flairWidth);
      console.log(
        `${marker.padStart(4)}  ${user}  ${String(row.points).padStart(12)}  ${String(row.tier).padStart(4)}  ${flair}  ${row.status}`,
      );
    }

    if (end >= ranked.length) break;
    const answer = (await rl.question('\nType q then Enter to continue, anything else to stop: ')).trim().toLowerCase();
    if (answer !== 'q') {
      console.log('Stopped before the end of the ranking.');
      break;
    }
  }
} finally {
  rl.close();
}
