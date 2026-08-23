import type { RedditFlairAssignment } from '../reddit/types.ts';

export type ReputationTier = 0 | 1 | 2 | 3 | 4;
export type ReputationStatus = 'ordinary' | 'warned' | 'uncivil' | 'banned' | 'scam' | 'moderator' | 'unmapped';
export type OrdinaryTier = Exclude<ReputationTier, 0>;
export type TierFlairText = ':mae:' | ':lisa:' | ':kita:' | ':aoi:' | ':hana:' | ':rin:' | ':celeste:';

export type TierFlair = {
  readonly tier: OrdinaryTier;
  readonly text: TierFlairText;
  readonly seedPoints: 1 | 10 | 100 | 1000;
};

export const TIER_FLAIRS: readonly TierFlair[] = [
  { tier: 1, text: ':mae:', seedPoints: 1 },
  { tier: 1, text: ':lisa:', seedPoints: 1 },
  { tier: 2, text: ':kita:', seedPoints: 10 },
  { tier: 2, text: ':aoi:', seedPoints: 10 },
  { tier: 3, text: ':hana:', seedPoints: 100 },
  { tier: 3, text: ':rin:', seedPoints: 100 },
  { tier: 4, text: ':celeste:', seedPoints: 1000 },
] as const;

const normalise = (value: string | null): string => value?.trim().toLowerCase() ?? '';

export const tierForPoints = (points: number): ReputationTier => {
  if (!Number.isSafeInteger(points) || points <= 0) return 0;
  if (points <= 9) return 1;
  if (points <= 99) return 2;
  if (points <= 999) return 3;
  return 4;
};

export const tierFlair = (assignment: RedditFlairAssignment): TierFlair | null => {
  const text = normalise(assignment.text);
  return TIER_FLAIRS.find(value => value.text === text) ?? null;
};

export const moderationStatus = (
  assignment: RedditFlairAssignment,
  redditBanned: boolean,
): { readonly status: ReputationStatus; readonly points: number } | null => {
  const text = normalise(assignment.text);
  const css = normalise(assignment.cssClass);

  if (text === 'scam' || text.includes('scam') || css === 's') {
    return { status: 'scam', points: -4 };
  }
  if (redditBanned) return { status: 'banned', points: -3 };
  if (text === 'uncivil' || text.includes('uncivil') || css === 'u') {
    return { status: 'uncivil', points: -2 };
  }
  if (text === 'warned' || text.includes('warn') || css === 'w') {
    return { status: 'warned', points: -1 };
  }
  return null;
};

export const chooseFlairForTier = (
  tier: OrdinaryTier,
  random: () => number = Math.random,
): TierFlairText => {
  const roll = random();
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new Error('Reputation flair random source must return [0, 1)');
  if (tier === 1) return roll < 0.01 ? ':lisa:' : ':mae:';
  if (tier === 2) return roll < 0.001 ? ':aoi:' : ':kita:';
  if (tier === 3) return roll < 0.0001 ? ':rin:' : ':hana:';
  return ':celeste:';
};

export const chooseTierOneFlair = (random: () => number = Math.random): ':mae:' | ':lisa:' => {
  const chosen = chooseFlairForTier(1, random);
  return chosen === ':lisa:' ? ':lisa:' : ':mae:';
};
