import type { ModerationClassification } from '../mod/classifier.ts';
import {
  BAN_TRIGGER_POINTS,
  RECOVERABLE_REPUTATION_FLOOR,
  REPUTATION_FLOOR,
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

const permanent = (status: 'banned' | 'scam'): ReputationTransition => ({
  points: REPUTATION_FLOOR,
  tier: 0,
  status,
  remove: true,
  ban: true,
});

const activeStatus = (points: number): ReputationStatus => {
  if (points >= 1) return 'ordinary';
  if (points <= -2) return 'uncivil';
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

const deductOne = (subject: ReputationSubject, remove: boolean): ReputationTransition => {
  const next = subject.points - 1;
  if (next <= BAN_TRIGGER_POINTS) return permanent('banned');
  return active(Math.max(RECOVERABLE_REPUTATION_FLOOR, next), remove);
};

const severe = (subject: ReputationSubject): ReputationTransition => {
  if (subject.status === 'scam') return permanent('scam');
  if (subject.status === 'banned') return permanent('banned');

  // A severe violation wipes all positive standing on the first offence.
  // Once already warned/uncivil, each further violation deepens the debt by one.
  if (subject.points >= 0) return active(-1, true);
  return deductOne(subject, true);
};

const low = (subject: ReputationSubject): ReputationTransition => {
  if (subject.status === 'scam') return permanent('scam');
  if (subject.status === 'banned') return permanent('banned');

  const next = clampReputationPoints(subject.points - 1);
  if (next <= BAN_TRIGGER_POINTS) return permanent('banned');
  if (next <= 0) return active(Math.max(RECOVERABLE_REPUTATION_FLOOR, next), false);
  return {
    points: next,
    tier: tierForPoints(next),
    status: 'ordinary',
    remove: false,
    ban: false,
  };
};

const clean = (subject: ReputationSubject): ReputationTransition => applyPositiveCredits(subject, 1);

export const applyModerationClassification = (
  subject: ReputationSubject,
  classification: ModerationClassification,
): ReputationTransition => {
  if (classification.verdict === 'clean') return clean(subject);
  if (classification.verdict === 'low') return low(subject);
  if (classification.verdict === 'scam') return permanent('scam');
  return severe(subject);
};
