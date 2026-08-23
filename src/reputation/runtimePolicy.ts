import type { ModerationClassification } from '../mod/classifier.ts';
import {
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

const severe = (subject: ReputationSubject): ReputationTransition => {
  if (subject.status === 'scam') return permanent('scam');
  if (subject.status === 'banned') return permanent('banned');
  if (subject.status === 'uncivil') return permanent('banned');
  if (subject.status === 'warned') {
    return { points: -2, tier: 0, status: 'uncivil', remove: true, ban: false };
  }
  return { points: -1, tier: 0, status: 'warned', remove: true, ban: false };
};

const low = (subject: ReputationSubject): ReputationTransition => {
  if (subject.status === 'scam') return permanent('scam');
  if (subject.status === 'banned') return permanent('banned');
  if (subject.status === 'warned' || subject.status === 'uncivil') {
    return {
      points: subject.points,
      tier: 0,
      status: subject.status,
      remove: false,
      ban: false,
    };
  }
  const points = clampReputationPoints(subject.points - 1);
  if (points < 0) return { points: -1, tier: 0, status: 'warned', remove: false, ban: false };
  return { points, tier: tierForPoints(points), status: 'ordinary', remove: false, ban: false };
};

const clean = (subject: ReputationSubject): ReputationTransition => {
  if (subject.status === 'scam') return permanent('scam');
  if (subject.status === 'banned') return permanent('banned');
  if (subject.status === 'warned' || subject.status === 'uncivil') {
    return {
      points: subject.points,
      tier: 0,
      status: subject.status,
      remove: false,
      ban: false,
    };
  }
  const points = clampReputationPoints(Math.max(0, subject.points) + 1);
  return { points, tier: tierForPoints(points), status: 'ordinary', remove: false, ban: false };
};

export const applyModerationClassification = (
  subject: ReputationSubject,
  classification: ModerationClassification,
): ReputationTransition => {
  if (classification.verdict === 'clean') return clean(subject);
  if (classification.verdict === 'low') return low(subject);
  if (classification.verdict === 'scam') return permanent('scam');
  return severe(subject);
};
