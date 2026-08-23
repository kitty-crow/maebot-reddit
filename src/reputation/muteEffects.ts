import { isMap, type Json } from '../types/json.ts';
import { redditMuteAction } from './mutePolicy.ts';
import type { ReputationPendingMute } from './store.ts';

const integerOrNull = (value: Json | undefined): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null;

export const reconciledMuteEffects = (
  raw: Json,
  candidates: readonly ReputationPendingMute[],
  nowMs: number,
): readonly ReputationPendingMute[] => {
  if (!isMap(raw) || !isMap(raw['discipline'])) throw new Error('Reputation discipline map is unavailable');
  const discipline = raw['discipline'];
  const output: ReputationPendingMute[] = [];

  for (const candidate of candidates) {
    const record = discipline[candidate.username.trim().toLowerCase()];
    if (!isMap(record)) continue;
    const action = redditMuteAction(
      {
        muteUntil: integerOrNull(record['muteUntil']),
        permanent: record['mutePermanent'] === true,
      },
      {
        redditMuted: record['redditMuted'] === true,
        appliedAt: integerOrNull(record['muteAppliedAt']),
      },
      nowMs,
    );
    if (action === null) continue;
    output.push({
      username: candidate.username,
      action,
      note: action === 'mute'
        ? record['mutePermanent'] === true
          ? 'Mae permanent reputation enforcement'
          : 'Mae uncivil reputation state'
        : 'Mae reputation mute ended',
    });
  }
  return output;
};