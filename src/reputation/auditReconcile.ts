import { createHash } from 'node:crypto';
import { isMap, type Json, type JsonMap } from '../types/json.ts';
import { disciplineTransition } from './discipline.ts';
import {
  chooseFlairForTier,
  tierForPoints,
  type OrdinaryTier,
  type ReputationStatus,
  type ReputationTier,
} from './policy.ts';

export type ReputationAuditResult = {
  readonly username: string;
  readonly beforePoints: number;
  readonly afterPoints: number;
  readonly beforeStatus: ReputationStatus;
  readonly afterStatus: ReputationStatus;
};

const textOrNull = (value: Json | undefined): string | null => typeof value === 'string' ? value : null;
const bool = (value: Json | undefined): boolean => value === true;
const integerOrNull = (value: Json | undefined): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
const tier = (value: Json | undefined): ReputationTier =>
  value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 9 ? value : 0;
const status = (value: Json | undefined): ReputationStatus => {
  if (
    value === 'ordinary' || value === 'warned' || value === 'uncivil' || value === 'banned'
    || value === 'scam' || value === 'moderator' || value === 'unmapped'
  ) return value;
  return 'unmapped';
};

const mapField = (value: JsonMap, name: string): JsonMap => {
  const field = value[name];
  if (!isMap(field)) throw new Error(`Reputation ${name} map is invalid`);
  return field;
};

const root = (value: Json): JsonMap => {
  if (!isMap(value) || value['schema'] !== 1) throw new Error('Canonical reputation store is not schema 1');
  if (!isMap(value['users'])) throw new Error('Canonical reputation users map is missing');
  if (!isMap(value['reputationJournal'])) value['reputationJournal'] = {};
  if (!isMap(value['discipline'])) value['discipline'] = {};
  return value;
};

const reference = (value: JsonMap, name: string): string | null => {
  const refs = mapField(mapField(value, 'flairReferences'), 'user');
  const selected = refs[name];
  return typeof selected === 'string' && selected.length > 0 ? selected : null;
};

const catalogueText = (value: JsonMap, templateId: string): string => {
  const catalog = mapField(value, 'flairCatalog');
  const users = catalog['user'];
  if (!Array.isArray(users)) throw new Error('Reputation user flair catalog is invalid');
  for (const item of users) {
    if (!isMap(item) || item['id'] !== templateId) continue;
    if (typeof item['text'] === 'string') return item['text'];
    throw new Error(`Flair template ${templateId} has no text`);
  }
  throw new Error(`Flair template ${templateId} is missing from the reputation catalog`);
};

const stableRoll = (username: string, targetTier: OrdinaryTier, eventKey: string): number => {
  const digest = createHash('sha256')
    .update('mae-runtime-tier-entry\0')
    .update(username.trim().toLowerCase())
    .update('\0')
    .update(String(targetTier))
    .update('\0')
    .update(eventKey)
    .digest();
  return digest.readUIntBE(0, 6) / 281_474_976_710_656;
};

const ordinaryReferenceName = (text: string): string => {
  if (text === ':mae:') return 'mae';
  if (text === ':lisa:') return 'lisa';
  if (text === ':kita:') return 'kita';
  if (text === ':aoi:') return 'aoi';
  if (text === ':hana:') return 'hana';
  if (text === ':rin:') return 'rin';
  if (text === ':celeste:') return 'celeste';
  return 'pawsomeContributor';
};

const desiredFor = (
  value: JsonMap,
  user: JsonMap,
  username: string,
  nextPoints: number,
  nextTier: ReputationTier,
  nextStatus: ReputationStatus,
  eventKey: string,
): { readonly id: string | null; readonly text: string | null } => {
  if (nextStatus === 'warned' || nextStatus === 'uncivil' || nextStatus === 'scam') {
    const name = nextStatus === 'warned' ? 'warned' : nextStatus === 'uncivil' ? 'uncivil' : 'scam';
    const id = reference(value, name);
    if (id === null) throw new Error(`${nextStatus} flair reference is unavailable`);
    return { id, text: catalogueText(value, id) };
  }

  const currentId = textOrNull(user['currentFlairTemplateId']);
  const currentText = textOrNull(user['currentFlairText']);
  if (nextStatus === 'banned' || nextStatus === 'moderator') return { id: currentId, text: currentText };
  if (nextTier === 0 || nextPoints <= 0) return { id: currentId, text: currentText };
  if (nextTier === 9) throw new Error('Moderator tier cannot receive an ordinary member flair');

  const previousTier = tier(user['tier']);
  const previousDesiredId = textOrNull(user['desiredFlairTemplateId']);
  if (nextTier === previousTier && previousDesiredId !== null) {
    return { id: previousDesiredId, text: textOrNull(user['desiredFlairText']) };
  }

  const selectedText = chooseFlairForTier(nextTier, () => stableRoll(username, nextTier, eventKey));
  const id = reference(value, ordinaryReferenceName(selectedText));
  if (id === null) throw new Error(`Ordinary flair reference is unavailable for ${selectedText}`);
  return { id, text: selectedText };
};

const reconcileDiscipline = (
  value: JsonMap,
  username: string,
  beforeStatus: ReputationStatus,
  afterStatus: ReputationStatus,
  at: number,
): void => {
  const discipline = mapField(value, 'discipline');
  const key = username.toLowerCase();
  let record = discipline[key];
  if (!isMap(record)) {
    record = {
      muteUntil: null,
      mutePermanent: false,
      redditMuted: false,
      muteAppliedAt: null,
    };
    discipline[key] = record;
  }
  const transition = disciplineTransition({
    beforeStatus,
    afterStatus,
    violation: false,
    currentMute: {
      muteUntil: integerOrNull(record['muteUntil']),
      permanent: bool(record['mutePermanent']),
    },
    atMs: at * 1_000,
  });
  if (!transition.muteChanged) return;
  record['muteUntil'] = transition.mute.muteUntil;
  record['mutePermanent'] = transition.mute.permanent;
};

export const reconcileReputationAudit = (
  current: Json,
  results: readonly ReputationAuditResult[],
  auditId: string,
  at: number,
): Json => {
  const value = root(current);
  const users = mapField(value, 'users');
  const journal = mapField(value, 'reputationJournal');
  const seen = new Set<string>();

  for (const result of results) {
    const key = result.username.trim().toLowerCase();
    if (key.length === 0 || seen.has(key)) throw new Error(`Duplicate or empty audit user ${result.username}`);
    seen.add(key);

    const user = users[key];
    if (!isMap(user)) throw new Error(`Canonical reputation record missing for u/${result.username}`);
    const beforeStatus = status(user['status']);
    if (beforeStatus === 'moderator' || user['immutableModeratorFlair'] === true) {
      throw new Error(`Moderator u/${result.username} reached audit reconciliation mutation boundary`);
    }

    const beforePoints = typeof user['points'] === 'number' && Number.isSafeInteger(user['points']) ? user['points'] : 0;
    const nextTier = tierForPoints(result.afterPoints);
    const eventKey = `member-mod-notes-audit:${auditId}:${key}`;
    const desired = desiredFor(
      value,
      user,
      result.username,
      result.afterPoints,
      nextTier,
      result.afterStatus,
      eventKey,
    );

    user['points'] = result.afterPoints;
    user['tier'] = nextTier;
    user['status'] = result.afterStatus;
    user['desiredFlairTemplateId'] = desired.id;
    user['desiredFlairText'] = desired.text;
    user['needsFlair'] = desired.id !== null && desired.id !== textOrNull(user['currentFlairTemplateId']);
    user['needsReview'] = false;
    if (user['source'] === 'unmapped-flair') user['source'] = 'live-contribution';

    reconcileDiscipline(value, result.username, beforeStatus, result.afterStatus, at);
    if (!Object.hasOwn(journal, eventKey)) {
      journal[eventKey] = {
        kind: 'member-mod-notes-audit-reconcile',
        username: result.username,
        at,
        beforePoints,
        afterPoints: result.afterPoints,
        beforeStatus,
        afterStatus: result.afterStatus,
        auditBeforePoints: result.beforePoints,
        auditBeforeStatus: result.beforeStatus,
        auditId,
      };
    }
  }

  return value;
};
