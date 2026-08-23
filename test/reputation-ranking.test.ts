import { expect, test } from 'bun:test';
import { rankReputationRows, type ReputationRankingRow } from '../src/reputation/ranking.ts';

const row = (
  username: string,
  points: number,
  tier: number,
  moderator = false,
): ReputationRankingRow => ({
  username,
  points,
  tier: moderator ? 5 : tier,
  status: moderator ? 'moderator' : 'ordinary',
  currentFlairText: moderator ? 'Moderator' : ':mae:',
  immutableModeratorFlair: moderator,
});

test('reputation ranking keeps tier-five moderators first then sorts everyone else by decreasing score', () => {
  const ranked = rankReputationRows([
    row('low', 1, 1),
    row('top', 1200, 4),
    row('mod-z', 0, 0, true),
    row('middle', 100, 3),
    row('mod-a', 0, 0, true),
    row('negative', -2, 0),
    row('tie-b', 10, 2),
    row('tie-a', 10, 2),
  ]);

  expect(ranked.filter(value => value.status === 'moderator').every(value => value.tier === 5)).toBe(true);
  expect(ranked.map(value => value.username)).toEqual([
    'mod-a',
    'mod-z',
    'top',
    'middle',
    'tie-a',
    'tie-b',
    'low',
    'negative',
  ]);
});
