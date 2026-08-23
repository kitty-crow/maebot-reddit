import { isMap, type Json } from '../types/json.ts';
import { redditMuteAction } from './mutePolicy.ts';
import type { ReputationPendingMute } from './store.ts';

const text = (value: Json | undefined): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;
const integerOrNull = (value: Json | undefined): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
const bool = (value: Json | undefined): boolean => value === true;

export const reputationMuteEffects = (
  raw: Json,
  nowMs = Date.now(),
): readonly ReputationPendingMute[] => {
  if (!isMap(raw)) throw new Error('Reputation mute reconciliation root must be an object');
  const users = raw['users'];
  const discipline = raw['discipline'];
  if (!isMap(users) || !isMap(discipline)) throw new Error('Reputation mute reconciliation maps are missing');

  const effects: ReputationPendingMute[] = [];
  for (const [key, userRaw] of Object.entries(users)) {
    if (!isMap(userRaw)) continue;
    const username = text(userRaw['username']) ?? key;
    const record = discipline[key];
    if (!isMap(record)) continue;
    const muteUntil = integerOrNull(record['muteUntil']);
    const permanent = bool(record['mutePermanent']);
    const redditMuted = bool(record['redditMuted']);
    const appliedAt = integerOrNull(record['muteAppliedAt']);
    const action = redditMuteAction(
      { muteUntil, permanent },
      { redditMuted, appliedAt },
      nowMs,
    );
    if (action === null) continue;
    effects.push({
      username,
      action,
      note: action === 'unmute'
        ? 'Mae reputation mute ended'
        : permanent
          ? 'Mae permanent reputation enforcement'
          : 'Mae uncivil reputation state',
    });
  }
  return effects.sort((a, b) => a.username.localeCompare(b.username));
};
