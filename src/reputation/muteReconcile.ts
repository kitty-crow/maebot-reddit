import { isMap, type Json, type JsonMap } from '../types/json.ts';
import { NATIVE_PERMANENT_MUTE_POLICY_FROM_MS, redditMuteAction, UNCIVIL_MUTE_MS } from './mutePolicy.ts';
import type { ReputationPendingMute } from './store.ts';

export type ReputationDesiredMute = {
  readonly username: string;
  readonly muteUntil: number | null;
  readonly permanent: boolean;
};

const text = (value: Json | undefined): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;
const integerOrNull = (value: Json | undefined): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
const bool = (value: Json | undefined): boolean => value === true;
const secondsToMilliseconds = (value: Json | undefined): number | null => {
  const seconds = integerOrNull(value);
  if (seconds === null || seconds < 0) return null;
  const milliseconds = seconds * 1_000;
  return Number.isSafeInteger(milliseconds) ? milliseconds : null;
};

const disciplineMap = (raw: JsonMap): JsonMap => {
  const discipline = raw['discipline'];
  // Production reputation snapshots created before the discipline journal was
  // introduced legitimately omit this field. Treat absence as an empty
  // journal, but keep failing closed if a present value is malformed.
  if (discipline === undefined) return {};
  if (!isMap(discipline)) throw new Error('Reputation mute reconciliation discipline map is invalid');
  return discipline;
};

// Historical status and mute records cannot authorise a new mute. Only a
// fresh sanction event created under the new policy can issue one.
export const reputationMuteTriggeredAt = (raw: Json, username: string): number | null => {
  if (!isMap(raw)) throw new Error('Reputation mute issuance root must be an object');
  const record = disciplineMap(raw)[username.trim().toLowerCase()];
  return isMap(record) ? integerOrNull(record['muteTriggeredAt']) : null;
};

export const reputationMuteIssuanceAllowed = (raw: Json, username: string): boolean => {
  const triggeredAt = reputationMuteTriggeredAt(raw, username);
  return triggeredAt !== null && triggeredAt >= NATIVE_PERMANENT_MUTE_POLICY_FROM_MS;
};

export const reputationMuteUnmuteRequested = (raw: Json, username: string): boolean => {
  if (!isMap(raw)) throw new Error('Reputation mute unmute root must be an object');
  const record = disciplineMap(raw)[username.trim().toLowerCase()];
  const requestedAt = isMap(record) ? integerOrNull(record['unmuteRequestedAt']) : null;
  return requestedAt !== null && requestedAt >= NATIVE_PERMANENT_MUTE_POLICY_FROM_MS;
};

const desiredFor = (
  status: Json | undefined,
  muteUntil: number | null,
  permanent: boolean,
  appliedAt: number | null,
  legacyAnchorMs: number | null,
  nowMs: number,
): { readonly muteUntil: number | null; readonly permanent: boolean } => {
  // Bootstrap-seeded users predate the discipline journal. Their canonical
  // moderation status must still imply the same communication restriction.
  if (status === 'banned' || status === 'scam') return { muteUntil: null, permanent: true };
  if (muteUntil !== null || permanent) return { muteUntil, permanent };
  if (status === 'uncivil') {
    return {
      // Prefer the persisted application timestamp when a discipline record
      // exists. Legacy bootstrap users have no such record, so anchor their
      // one-time seven-day restriction to the canonical seededAt timestamp
      // rather than sliding the deadline forward on every poll.
      muteUntil: (appliedAt ?? legacyAnchorMs ?? nowMs) + UNCIVIL_MUTE_MS,
      permanent: false,
    };
  }
  return { muteUntil: null, permanent: false };
};

export const reputationDesiredMutes = (
  raw: Json,
  nowMs = Date.now(),
): readonly ReputationDesiredMute[] => {
  if (!isMap(raw)) throw new Error('Reputation mute reconciliation root must be an object');
  const users = raw['users'];
  if (!isMap(users)) throw new Error('Reputation mute reconciliation users map is missing');
  const discipline = disciplineMap(raw);

  const desired: ReputationDesiredMute[] = [];
  for (const [key, userRaw] of Object.entries(users)) {
    if (!isMap(userRaw) || isMap(userRaw['unreachable'])) continue;
    const username = text(userRaw['username']) ?? key;
    const record = discipline[key];
    const muteUntil = isMap(record) ? integerOrNull(record['muteUntil']) : null;
    const permanent = isMap(record) && bool(record['mutePermanent']);
    const appliedAt = isMap(record) ? integerOrNull(record['muteAppliedAt']) : null;
    desired.push({
      username,
      ...desiredFor(
        userRaw['status'],
        muteUntil,
        permanent,
        appliedAt,
        secondsToMilliseconds(userRaw['seededAt']),
        nowMs,
      ),
    });
  }
  return desired.sort((left, right) => left.username.localeCompare(right.username));
};

export const reputationMuteEffects = (
  raw: Json,
  nowMs = Date.now(),
): readonly ReputationPendingMute[] => {
  if (!isMap(raw)) throw new Error('Reputation mute reconciliation root must be an object');
  const discipline = disciplineMap(raw);

  const effects: ReputationPendingMute[] = [];
  for (const desired of reputationDesiredMutes(raw, nowMs)) {
    const record = discipline[desired.username.trim().toLowerCase()];
    const redditMuted = isMap(record) && bool(record['redditMuted']);
    const appliedAt = isMap(record) ? integerOrNull(record['muteAppliedAt']) : null;
    const action = redditMuteAction(
      { muteUntil: desired.muteUntil, permanent: desired.permanent },
      { redditMuted, appliedAt },
      nowMs,
    );
    if (action === null
      || (action === 'mute' && !reputationMuteIssuanceAllowed(raw, desired.username))
      || (action === 'unmute' && !reputationMuteUnmuteRequested(raw, desired.username))) continue;
    effects.push({
      username: desired.username,
      action,
      note: action === 'unmute'
        ? 'Mae reputation mute ended'
        : desired.permanent
          ? 'Mae permanent reputation enforcement'
          : 'Mae uncivil reputation state',
    });
  }
  return effects;
};
