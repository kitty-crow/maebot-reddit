// Historical contributions are never submitted for automated LLM moderation.
// Reddit creation timestamps are expressed as UTC seconds.
export const CONTRIBUTION_MODERATION_CUTOFF_UTC = Date.parse('2026-09-01T00:00:00Z') / 1_000;

export const eligibleForContributionModeration = (createdUtc: number): boolean =>
  Number.isFinite(createdUtc) && createdUtc >= CONTRIBUTION_MODERATION_CUTOFF_UTC;
