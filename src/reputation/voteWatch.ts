export type VoteObservation = {
  readonly score: number;
  readonly at: number;
};

export type VoteSuspicion = {
  readonly delta: number;
  readonly elapsedSeconds: number;
  readonly ratePerMinute: number;
  readonly reason: string;
  readonly evidence: readonly string[];
};

const safe = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer`);
};

/**
 * Conservative moderator-review heuristic, not a guilt decision.
 *
 * Reddit does not expose voter identities or vote timestamps to subreddit
 * moderators. Mae therefore only has score trajectory evidence. Sudden large
 * score jumps are surfaced for human confirmation; they never punish a user
 * by themselves.
 */
export const suspiciousVoteGrowth = (
  previous: VoteObservation,
  current: VoteObservation,
): VoteSuspicion | null => {
  safe(previous.score, 'Previous Reddit score');
  safe(current.score, 'Current Reddit score');
  safe(previous.at, 'Previous vote observation timestamp');
  safe(current.at, 'Current vote observation timestamp');
  if (current.at <= previous.at || current.score <= previous.score) return null;

  const delta = current.score - previous.score;
  const elapsedSeconds = current.at - previous.at;
  const ratePerMinute = delta * 60 / elapsedSeconds;

  // These are intentionally review-biased rather than punitive thresholds.
  // A human moderator must confirm manipulation through Discord/Telegram.
  const fiveMinuteBurst = elapsedSeconds <= 5 * 60 && delta >= 10 && ratePerMinute >= 2;
  const halfHourBurst = elapsedSeconds <= 30 * 60 && delta >= 25 && ratePerMinute >= 1;
  const extremeBurst = elapsedSeconds <= 60 * 60 && delta >= 50;
  if (!fiveMinuteBurst && !halfHourBurst && !extremeBurst) return null;

  return {
    delta,
    elapsedSeconds,
    ratePerMinute,
    reason: 'Reddit score increased unusually quickly; possible vote manipulation requires moderator review.',
    evidence: [
      `score ${previous.score} -> ${current.score} (+${delta})`,
      `elapsed ${elapsedSeconds}s`,
      `observed rate ${ratePerMinute.toFixed(2)} votes/min`,
      'Trajectory alone is not proof; confirm or reject this case manually.',
    ],
  };
};
