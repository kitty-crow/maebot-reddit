export type ReputationRankingRow = {
  readonly username: string;
  readonly points: number;
  readonly tier: number;
  readonly status: string;
  readonly currentFlairText: string | null;
  readonly immutableModeratorFlair: boolean;
};

export const rankReputationRows = (
  rows: readonly ReputationRankingRow[],
): readonly ReputationRankingRow[] => [...rows].sort((left, right) => {
  if (left.immutableModeratorFlair !== right.immutableModeratorFlair) {
    return left.immutableModeratorFlair ? -1 : 1;
  }
  if (left.points !== right.points) return right.points - left.points;
  return left.username.localeCompare(right.username, undefined, { sensitivity: 'base' });
});
