import { isMap, type Json } from '../types/json.ts';
import { redditMuteAction, UNCIVIL_MUTE_MS } from './mutePolicy.ts';
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

const desiredFor = (
  status: Json | undefined,
  muteUntil: number | null,
  permanent: boolean,
  appliedAt: number | null,
  nowMs: number,
): { readonly muteUntil: number | null; readonly permanent: boolean } => {
  // Bootstrap-seeded users predate the discipline journal. Their canonical
  // moderation status must still imply the same communication restriction.
  if (status === 'banned' || status === 'scam') return { muteUntil: null, permanent: true };
  if (muteUntil !== null || permanent) return { muteUntil, permanent };
  if (status === 'uncivil') {
    return {
      muteUntil: (appliedAt ?? nowMs) + UNCIVIL_MUTE_MS,
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
  const discipline = raw['discipline'];
  if (!isMap(users) || !isMap(discipline)) throw new Error('Reputation mute reconciliation maps are missing');

  const desired: ReputationDesiredMute[] = [];
  for (const [key, userRaw] of Object.entries(users)) {
    if (!isMap(userRaw)) continue;
    const username = text(userRaw['username']) ?? key;
    const record = discipline[key];
    const muteUntil = isMap(record) ? integerOrNull(record['muteUntil']) : null;
    const permanent = isMap(record) && bool(record['mutePermanent']);
    const appliedAt = isMap(record) ? integerOrNull(record['muteAppliedAt']) : null;
    desired.push({
      username,
      ...desiredFor(userRaw['status'], muteUntil, permanent, appliedAt, nowMs),
    });
  }
  return desired.sort((left, right) => left.username.localeCompare(right.username));
};

export const reputationMuteEffects = (
  raw: Json,
  nowMs = Date.now(),
): readonly ReputationPendingMute[] => {
  if (!isMap(raw)) throw new Error('Reputation mute reconciliation root must be an object');
  const discipline = raw['discipline'];
  if (!isMap(discipline)) throw new Error('Reputation mute reconciliation discipline map is missing');

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
    if (action === null) continue;
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
