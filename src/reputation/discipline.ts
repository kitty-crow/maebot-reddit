import type { ReputationStatus } from './policy.ts';
import {
  clearRedeemedMute,
  extendUncivilMute,
  permanentMute,
  type ReputationMuteState,
} from './mutePolicy.ts';

export type DisciplineTransitionInput = {
  readonly beforeStatus: ReputationStatus;
  readonly afterStatus: ReputationStatus;
  readonly violation: boolean;
  readonly currentMute: ReputationMuteState;
  readonly atMs: number;
};

export type DisciplineTransition = {
  readonly mute: ReputationMuteState;
  readonly muteChanged: boolean;
};

const sameMute = (a: ReputationMuteState, b: ReputationMuteState): boolean =>
  a.muteUntil === b.muteUntil && a.permanent === b.permanent;

export const disciplineTransition = (input: DisciplineTransitionInput): DisciplineTransition => {
  let mute = input.currentMute;

  if (input.afterStatus === 'banned' || input.afterStatus === 'scam') {
    mute = permanentMute();
  } else if (input.beforeStatus === 'uncivil' && input.afterStatus !== 'uncivil') {
    // Redemption into warned/ordinary immediately removes any remaining
    // uncivil mute debt. Moderator/unmapped transitions also must not inherit it.
    mute = clearRedeemedMute();
  } else if (input.afterStatus === 'uncivil') {
    const enteredUncivil = input.beforeStatus !== 'uncivil';
    const newMarkWhileUncivil = input.beforeStatus === 'uncivil' && input.violation;
    if (enteredUncivil || newMarkWhileUncivil) {
      // One offending event adds one seven-day period regardless of whether a
      // severe deduction jumped across several numerical reputation points.
      mute = extendUncivilMute(mute, input.atMs);
    }
  }

  return { mute, muteChanged: !sameMute(mute, input.currentMute) };
};

export const constructiveResolutionTransition = (
  status: ReputationStatus,
  currentMute: ReputationMuteState,
): DisciplineTransition => {
  if (status === 'banned' || status === 'scam' || currentMute.permanent) {
    return { mute: currentMute, muteChanged: false };
  }
  const mute = clearRedeemedMute();
  return { mute, muteChanged: !sameMute(mute, currentMute) };
};
