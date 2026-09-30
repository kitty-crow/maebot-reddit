export const UNCIVIL_MUTE_DAYS = 7;
export const UNCIVIL_MUTE_MS = UNCIVIL_MUTE_DAYS * 24 * 60 * 60 * 1_000;

export type ReputationMuteState = {
  readonly muteUntil: number | null;
  readonly permanent: boolean;
};

export type RedditMuteApplicationState = {
  readonly redditMuted: boolean;
  readonly appliedAt: number | null;
};

export type RedditMuteAction = 'mute' | 'unmute' | null;

export const extendUncivilMute = (
  current: ReputationMuteState,
  now: number,
): ReputationMuteState => {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Mute timestamp must be a non-negative safe integer');
  if (current.permanent) return current;
  const base = current.muteUntil !== null && current.muteUntil > now
    ? current.muteUntil
    : now;
  return {
    muteUntil: base + UNCIVIL_MUTE_MS,
    permanent: false,
  };
};

export const clearRedeemedMute = (): ReputationMuteState => ({
  muteUntil: null,
  permanent: false,
});

export const permanentMute = (): ReputationMuteState => ({
  muteUntil: null,
  permanent: true,
});

export const muteRemainingMs = (
  current: ReputationMuteState,
  now: number,
): number | null => {
  if (current.permanent) return null;
  if (current.muteUntil === null || current.muteUntil <= now) return 0;
  return current.muteUntil - now;
};

export const redditMuteAction = (
  desired: ReputationMuteState,
  applied: RedditMuteApplicationState,
  now: number,
): RedditMuteAction => {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Mute reconciliation timestamp must be a non-negative safe integer');
  const shouldMute = desired.permanent || (desired.muteUntil !== null && desired.muteUntil > now);
  if (!shouldMute) return applied.redditMuted ? 'unmute' : null;

  // Reddit sends a user-visible moderation message whenever a subreddit mute is
  // applied. Mae therefore projects each canonical mute sanction to Reddit at
  // most once. The durable application checkpoint deliberately remains set
  // after Reddit's native mute expires, so a ban never turns into recurring
  // mute-notification spam.
  if (applied.redditMuted || applied.appliedAt !== null) return null;
  return 'mute';
};
