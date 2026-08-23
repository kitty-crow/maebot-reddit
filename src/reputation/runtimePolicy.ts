import type { ModerationClassification } from '../mod/classifier.ts';
import {
  BAN_TRIGGER_POINTS,
  REPUTATION_FLOOR,
  UNCIVIL_CEILING,
  clampReputationPoints,
  tierForPoints,
  type ReputationStatus,
  type ReputationTier,
} from './policy.ts';

export type ReputationTransition = {
  readonly points: number;
  readonly tier: ReputationTier;
  readonly status: ReputationStatus;
  readonly remove: boolean;
  readonly ban: boolean;
};

export type ReputationSubject = {
  readonly points: number;
  readonly status: ReputationStatus;
};

export type ReputationContributionKind = 'post' | 'comment';

const permanent = (status: 'banned' | 'scam'): ReputationTransition => ({
  points: REPUTATION_FLOOR,
  tier: 0,
  status,
  remove: true,
  ban: true,
});

const activeStatus = (points: number): ReputationStatus => {
  if (points >= 1) return 'ordinary';
  if (points <= UNCIVIL_CEILING) return 'uncivil';
  return 'warned';
};

const active = (
  points: number,
  remove: boolean,
): ReputationTransition => ({
  points,
  tier: tierForPoints(points),
  status: activeStatus(points),
  remove,
  ban: false,
});

export const applyPositiveCredits = (
  subject: ReputationSubject,
  credits: number,
): ReputationTransition => {
  if (!Number.isSafeInteger(credits) || credits < 0) {
    throw new Error('Positive reputation credits must be a non-negative safe integer');
  }
  if (subject.status === 'scam') return permanent('scam');
  if (subject.status === 'banned') return permanent('banned');
  const points = clampReputationPoints(subject.points + credits);
  if (points <= 0) return active(points, false);
  return {
    points,
    tier: tierForPoints(points),
    status: 'ordinary',
    remove: false,
    ban: false,
  };
};

const deduct = (
  subject: ReputationSubject,
  points: number,
  remove: boolean,
): ReputationTransition => {
  if (!Number.isSafeInteger(points) || points < 1) {
    throw new Error('Reputation deduction must be a positive safe integer');
  }
  const next = subject.points - points;
  if (next <= BAN_TRIGGER_POINTS) return permanent('banned');
  return active(clampReputationPoints(next), remove);
};

const low = (subject: ReputationSubject): ReputationTransition => {
  if (subject.status === 'scam') return permanent('scam');
  if (subject.status === 'banned') return permanent('banned');
  return deduct(subject, 1, false);
};

const severe = (
  subject: ReputationSubject,
  classification: ModerationClassification,
): ReputationTransition => {
  if (subject.status === 'scam') return permanent('scam');
  if (subject.status === 'banned') return permanent('banned');
  if (classification.penaltyPoints < 10) {
    throw new Error('Severe moderation must deduct at least 10 reputation points');
  }
  return deduct(subject, classification.penaltyPoints, true);
};

const clean = (subject: ReputationSubject): ReputationTransition => applyPositiveCredits(subject, 1);

export const applyModerationClassification = (
  subject: ReputationSubject,
  classification: ModerationClassification,
): ReputationTransition => {
  if (classification.verdict === 'clean') return clean(subject);
  if (classification.verdict === 'low') return low(subject);
  if (classification.verdict === 'scam') return permanent('scam');
  return severe(subject, classification);
};

export const applyContributionPolicy = (
  subject: ReputationSubject,
  kind: ReputationContributionKind,
  classification: ModerationClassification,
): ReputationTransition => {
  const classified = applyModerationClassification(subject, classification);

  if (subject.status !== 'uncivil' || kind !== 'post') return classified;

  // Uncivil users are comment-only. Their posts are still LLM-audited, but a
  // clean prohibited post cannot be used as a redemption contribution.
  if (classification.verdict === 'clean') {
    return {
      points: subject.points,
      tier: 0,
      status: 'uncivil',
      remove: true,
      ban: false,
    };
  }

  // A prohibited post with an actual LLM violation receives the normal
  // reputation penalty and is removed regardless of the classifier's content
  // disposition.
  return { ...classified, remove: true };
};
