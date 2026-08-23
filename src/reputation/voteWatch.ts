export type VoteObservation = {
  readonly score: number;
  readonly at: number;
};

export type VoteWatchRule = {
  readonly name: string;
  readonly maxSeconds: number;
  readonly minDelta: number;
  readonly minRatePerMinute: number;
};

export type VoteWatchPolicy = {
  readonly rules: readonly VoteWatchRule[];
};

export type VoteSuspicion = {
  readonly delta: number;
  readonly elapsedSeconds: number;
  readonly ratePerMinute: number;
  readonly reason: string;
  readonly evidence: readonly string[];
};

type VoteWatchEnv = Readonly<Record<string, string | undefined>>;

const safe = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer`);
};

const envInteger = (
  env: VoteWatchEnv,
  name: string,
  fallback: number,
  minimum: number,
): number => {
  const raw = env[name]?.trim();
  if (raw === undefined || raw.length === 0) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer of at least ${minimum}`);
  }
  return value;
};

const envRate = (env: VoteWatchEnv, name: string, fallback: number): number => {
  const raw = env[name]?.trim();
  if (raw === undefined || raw.length === 0) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
};

/**
 * Reddit community moderation tools conventionally detect suspicious voting as
 * N votes within T time, with N/T tuned to the individual community. These
 * defaults preserve Mae's conservative bootstrap behaviour, but production can
 * calibrate every window without changing code as the subreddit's normal vote
 * velocity becomes better understood.
 */
export const configuredVoteWatchPolicy = (env: VoteWatchEnv = process.env): VoteWatchPolicy => ({
  rules: [
    {
      name: 'fast community burst',
      maxSeconds: envInteger(env, 'REDDIT_VOTE_WATCH_FAST_SECONDS', 5 * 60, 1),
      minDelta: envInteger(env, 'REDDIT_VOTE_WATCH_FAST_DELTA', 10, 1),
      minRatePerMinute: envRate(env, 'REDDIT_VOTE_WATCH_FAST_RATE', 2),
    },
    {
      name: 'medium community burst',
      maxSeconds: envInteger(env, 'REDDIT_VOTE_WATCH_MEDIUM_SECONDS', 30 * 60, 1),
      minDelta: envInteger(env, 'REDDIT_VOTE_WATCH_MEDIUM_DELTA', 25, 1),
      minRatePerMinute: envRate(env, 'REDDIT_VOTE_WATCH_MEDIUM_RATE', 1),
    },
    {
      name: 'large community burst',
      maxSeconds: envInteger(env, 'REDDIT_VOTE_WATCH_LARGE_SECONDS', 60 * 60, 1),
      minDelta: envInteger(env, 'REDDIT_VOTE_WATCH_LARGE_DELTA', 50, 1),
      minRatePerMinute: envRate(env, 'REDDIT_VOTE_WATCH_LARGE_RATE', 0),
    },
  ],
});

const validPolicy = (policy: VoteWatchPolicy): void => {
  if (policy.rules.length === 0) throw new Error('Vote-watch policy requires at least one rule');
  for (const rule of policy.rules) {
    if (rule.name.trim().length === 0) throw new Error('Vote-watch rule name cannot be empty');
    safe(rule.maxSeconds, `${rule.name} window`);
    safe(rule.minDelta, `${rule.name} minimum delta`);
    if (rule.maxSeconds < 1 || rule.minDelta < 1) throw new Error(`${rule.name} has invalid thresholds`);
    if (!Number.isFinite(rule.minRatePerMinute) || rule.minRatePerMinute < 0) {
      throw new Error(`${rule.name} has an invalid minimum rate`);
    }
  }
};

/**
 * Conservative moderator-review heuristic, never a guilt decision.
 *
 * Reddit does not expose voter identities or vote timestamps to subreddit
 * moderators. Mae therefore has score trajectory evidence only. A matching
 * community-calibrated N/T rule creates evidence for human review and cannot
 * itself deduct reputation, warn, mute, or ban anybody.
 */
export const suspiciousVoteGrowth = (
  previous: VoteObservation,
  current: VoteObservation,
  policy: VoteWatchPolicy = configuredVoteWatchPolicy(),
): VoteSuspicion | null => {
  safe(previous.score, 'Previous Reddit score');
  safe(current.score, 'Current Reddit score');
  safe(previous.at, 'Previous vote observation timestamp');
  safe(current.at, 'Current vote observation timestamp');
  validPolicy(policy);
  if (current.at <= previous.at || current.score <= previous.score) return null;

  const delta = current.score - previous.score;
  const elapsedSeconds = current.at - previous.at;
  const ratePerMinute = delta * 60 / elapsedSeconds;
  const matched = policy.rules.find(rule =>
    elapsedSeconds <= rule.maxSeconds
    && delta >= rule.minDelta
    && ratePerMinute >= rule.minRatePerMinute);
  if (matched === undefined) return null;

  return {
    delta,
    elapsedSeconds,
    ratePerMinute,
    reason: 'Reddit score growth exceeded the community-calibrated vote-velocity rule; possible manipulation requires moderator review.',
    evidence: [
      `score ${previous.score} -> ${current.score} (+${delta})`,
      `elapsed ${elapsedSeconds}s`,
      `observed rate ${ratePerMinute.toFixed(2)} votes/min`,
      `matched ${matched.name}: >=${matched.minDelta} votes within ${matched.maxSeconds}s at >=${matched.minRatePerMinute} votes/min`,
      'Trajectory alone is not proof; confirm or reject this case manually.',
    ],
  };
};
