export const UNCIVIL_MUTE_DAYS = 30;
export const UNCIVIL_MUTE_MS = UNCIVIL_MUTE_DAYS * 24 * 60 * 60 * 1_000;

export type ReputationMuteState = {
  readonly muteUntil: number | null;
  readonly permanent: boolean;
};

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
