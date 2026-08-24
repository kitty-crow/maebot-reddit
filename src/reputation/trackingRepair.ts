import { MODERATOR_POINTS, PAWSOME_POINTS, type ReputationStatus } from './policy.ts';
import { isMap, type Json, type JsonMap } from '../types/json.ts';

export type LiveTrackingFlair = {
  readonly username: string;
  readonly templateId: string | null;
  readonly text: string | null;
  readonly cssClass: string | null;
};

export type CanonicalPawsomeTracking = {
  readonly templateId: string;
  readonly text: string;
  readonly cssClass: string | null;
  readonly usernames: readonly string[];
};

export type ReputationTrackingRepairInput = {
  readonly at: number;
  readonly moderators: readonly LiveTrackingFlair[];
  readonly pawsome: CanonicalPawsomeTracking;
};

export type ReputationTrackingRepairResult = {
  readonly value: JsonMap;
  readonly moderatorsRepaired: number;
  readonly pawsomeRepaired: number;
};

const lower = (value: string): string => value.trim().toLowerCase();
const text = (value: Json | undefined): string | null => typeof value === 'string' ? value : null;
const flag = (value: Json | undefined): boolean => value === true;

export const isMisspelledPawsomeFlair = (value: string | null): boolean =>
  /^pawesome contributor(?:\s|$)/iu.test(value?.trim() ?? '');

const status = (value: Json | undefined): ReputationStatus | null => {
  if (
    value === 'ordinary' || value === 'warned' || value === 'uncivil' || value === 'banned'
    || value === 'scam' || value === 'moderator' || value === 'unmapped'
  ) return value;
  return null;
};

const root = (value: Json): JsonMap => {
  if (!isMap(value) || value['schema'] !== 1) throw new Error('Unsupported reputation store');
  if (!isMap(value['users'])) throw new Error('Reputation users map is invalid');
  return value;
};

const seededAt = (raw: JsonMap, fallback: number): number =>
  typeof raw['seededAt'] === 'number' && Number.isSafeInteger(raw['seededAt'])
    ? raw['seededAt']
    : fallback;

const moderatorRecord = (
  previous: JsonMap | null,
  moderator: LiveTrackingFlair,
  at: number,
): JsonMap => {
  if (previous !== null) {
    const previousStatus = status(previous['status']);
    if (previousStatus === 'banned' || previousStatus === 'scam') {
      throw new Error(`Refusing to overwrite permanent reputation state for moderator u/${moderator.username}`);
    }
  }

  return {
    ...(previous ?? {}),
    username: moderator.username,
    points: MODERATOR_POINTS,
    tier: 9,
    status: 'moderator',
    currentFlairTemplateId: moderator.templateId,
    currentFlairText: moderator.text,
    currentFlairCssClass: moderator.cssClass,
    desiredFlairTemplateId: moderator.templateId,
    desiredFlairText: moderator.text,
    immutableModeratorFlair: true,
    needsFlair: false,
    needsReview: false,
    source: 'moderator',
    seededAt: previous === null ? at : seededAt(previous, at),
  };
};

const pawsomeRecord = (
  previous: JsonMap,
  canonical: CanonicalPawsomeTracking,
): JsonMap => {
  if (status(previous['status']) !== 'unmapped' || !flag(previous['needsReview'])) {
    throw new Error(`Refusing to reseed resolved reputation state for u/${text(previous['username']) ?? '(unknown)'}`);
  }
  if (!isMisspelledPawsomeFlair(text(previous['currentFlairText']))) {
    throw new Error(`Unmapped user u/${text(previous['username']) ?? '(unknown)'} is not a misspelled Pawsome record`);
  }

  return {
    ...previous,
    points: PAWSOME_POINTS,
    tier: 5,
    status: 'ordinary',
    currentFlairTemplateId: canonical.templateId,
    currentFlairText: canonical.text,
    currentFlairCssClass: canonical.cssClass,
    desiredFlairTemplateId: canonical.templateId,
    desiredFlairText: canonical.text,
    immutableModeratorFlair: false,
    needsFlair: false,
    needsReview: false,
    source: 'tier-flair',
  };
};

export const repairReputationTracking = (
  current: Json,
  input: ReputationTrackingRepairInput,
): ReputationTrackingRepairResult => {
  const value = root(current);
  const users = value['users'];
  if (!isMap(users)) throw new Error('Reputation users map is invalid');

  const moderatorKeys = new Set(input.moderators.map(item => lower(item.username)));
  let moderatorsRepaired = 0;
  for (const moderator of input.moderators) {
    const key = lower(moderator.username);
    const raw = users[key];
    const previous = isMap(raw) ? raw : null;
    const alreadyCanonical = previous !== null
      && previous['status'] === 'moderator'
      && previous['tier'] === 9
      && previous['points'] === MODERATOR_POINTS
      && previous['immutableModeratorFlair'] === true
      && previous['needsReview'] !== true;
    if (alreadyCanonical) continue;
    users[key] = moderatorRecord(previous, moderator, input.at);
    moderatorsRepaired += 1;
  }

  let pawsomeRepaired = 0;
  for (const username of input.pawsome.usernames) {
    const key = lower(username);
    if (moderatorKeys.has(key)) {
      throw new Error(`u/${username} cannot be repaired as both moderator and Pawsome member`);
    }
    const raw = users[key];
    if (!isMap(raw)) throw new Error(`Missing reputation record for misspelled Pawsome user u/${username}`);
    users[key] = pawsomeRecord(raw, input.pawsome);
    pawsomeRepaired += 1;
  }

  return { value, moderatorsRepaired, pawsomeRepaired };
};

export const reputationUsersRequiringReview = (value: Json): readonly string[] => {
  const store = root(value);
  const users = store['users'];
  if (!isMap(users)) throw new Error('Reputation users map is invalid');
  const unresolved: string[] = [];
  for (const [key, raw] of Object.entries(users)) {
    if (!isMap(raw)) continue;
    if (raw['status'] !== 'unmapped' && raw['needsReview'] !== true) continue;
    unresolved.push(text(raw['username']) ?? key);
  }
  return unresolved.sort((left, right) => left.localeCompare(right));
};
