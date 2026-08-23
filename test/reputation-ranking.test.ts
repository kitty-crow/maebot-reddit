import { expect, test } from 'bun:test';
import { rankReputationRows, type ReputationRankingRow } from '../src/reputation/ranking.ts';
import { MODERATOR_POINTS, PAWSOME_POINTS, REPUTATION_FLOOR } from '../src/reputation/policy.ts';

const row = (
  username: string,
  points: number,
  tier: number,
  moderator = false,
): ReputationRankingRow => ({
  username,
  points: moderator ? MODERATOR_POINTS : points,
  tier: moderator ? 9 : tier,
  status: moderator ? 'moderator' : 'ordinary',
  currentFlairText: moderator ? 'Moderator' : tier === 5 ? 'Pawsome Contributor' : ':mae:',
  immutableModeratorFlair: moderator,
});

test('reputation ranking keeps tier-nine moderators first then sorts everyone else by decreasing score', () => {
  const ranked = rankReputationRows([
    row('low', 1, 1),
    row('pawsome', PAWSOME_POINTS, 5),
    row('top-tier-four', 1200, 4),
    row('mod-z', 0, 0, true),
    row('middle', 100, 3),
    row('mod-a', 0, 0, true),
    row('banned', REPUTATION_FLOOR, 0),
    row('tie-b', 10, 2),
    row('tie-a', 10, 2),
  ]);

  expect(ranked.filter(value => value.status === 'moderator').every(value => value.tier === 9)).toBe(true);
  expect(ranked.map(value => value.username)).toEqual([
    'mod-a',
    'mod-z',
    'pawsome',
    'top-tier-four',
    'middle',
    'tie-a',
    'tie-b',
    'low',
    'banned',
  ]);
});
