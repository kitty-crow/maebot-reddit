import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Json, JsonMap } from '../types/json.ts';
import { isMap, parseMap } from '../types/json.ts';
import { Store } from '../store/store.ts';

export type LegacyImportResult = {
  readonly commentHash: string;
  readonly submissionHash: string;
  readonly warnedUsers: number;
  readonly bannedUsers: number;
  readonly questions: number;
  readonly submissionQuestions: number;
  readonly leaderboardUsers: number;
  readonly haikuAuthors: number;
  readonly titm: number;
  readonly alreadyImported: boolean;
};

const initial = (): JsonMap => ({
  schema: 1,
  actions: {},
  twitter: {},
  questions: {},
  users: {},
  community: {
    titm: { total: 0, leaderboard: {} },
    haiku: { history: {} },
  },
});

const child = (parent: JsonMap, key: string): JsonMap => {
  const value = parent[key];
  if (isMap(value)) return value;
  const created: JsonMap = {};
  parent[key] = created;
  return created;
};

const sha256 = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');

const strings = (value: Json | undefined, name: string): readonly string[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`${name} must be an array of strings`);
  }
  return value.map(item => String(item));
};

const stringMap = (value: Json | undefined, name: string): ReadonlyMap<string, string> => {
  if (value === undefined || value === null) return new Map();
  if (!isMap(value)) throw new Error(`${name} must be an object`);
  const out = new Map<string, string>();
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') throw new Error(`${name}.${key} must be a string`);
    out.set(key, item);
  }
  return out;
};

const numberMap = (value: Json | undefined, name: string): ReadonlyMap<string, number> => {
  if (value === undefined || value === null) return new Map();
  if (!isMap(value)) throw new Error(`${name} must be an object`);
  const out = new Map<string, number>();
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'number' || !Number.isFinite(item)) throw new Error(`${name}.${key} must be a finite number`);
    out.set(key, item);
  }
  return out;
};

const haikuMap = (value: Json | undefined): ReadonlyMap<string, readonly string[]> => {
  if (value === undefined || value === null) return new Map();
  if (!isMap(value)) throw new Error('legacy Haikus must be an object');
  const out = new Map<string, readonly string[]>();
  for (const [author, item] of Object.entries(value)) {
    out.set(author, strings(item, `legacy Haikus.${author}`));
  }
  return out;
};

const questionTitles = (value: JsonMap): ReadonlyMap<string, string> => {
  const out = new Map<string, string>();
  for (const [key, item] of Object.entries(value)) {
    // The submission-moderation database is intentionally flat: submission id -> title.
    if (typeof item === 'string') out.set(key, item);
  }
  return out;
};

const jsonObject = (entries: ReadonlyMap<string, string | number | readonly string[]>): JsonMap => {
  const out: JsonMap = {};
  for (const [key, value] of entries) out[key] = Array.isArray(value) ? [...value] : value;
  return out;
};

export const importLegacyReddit = async (input: {
  readonly commentDb: string;
  readonly submissionDb: string;
  readonly stateFile: string;
  readonly importedAt?: number;
}): Promise<LegacyImportResult> => {
  const [commentBytes, submissionBytes] = await Promise.all([
    readFile(input.commentDb),
    readFile(input.submissionDb),
  ]);
  const commentHash = sha256(commentBytes);
  const submissionHash = sha256(submissionBytes);
  const comment = parseMap(commentBytes.toString('utf8'));
  const submission = parseMap(submissionBytes.toString('utf8'));

  const warned = strings(comment['warned_users'], 'legacy warned_users');
  const banned = strings(comment['banned_users'], 'legacy banned_users');
  const markers = stringMap(comment['questions'], 'legacy questions');
  const leaderboard = numberMap(comment['leaderboard'], 'legacy leaderboard');
  const haikus = haikuMap(comment['Haikus']);
  const titles = questionTitles(submission);
  const rawTitm = comment['titm'];
  const titm = rawTitm === undefined || rawTitm === null
    ? 0
    : typeof rawTitm === 'number' && Number.isFinite(rawTitm) && rawTitm >= 0
      ? Math.floor(rawTitm)
      : (() => { throw new Error('legacy titm must be a non-negative finite number'); })();

  const store = new Store(input.stateFile, initial());
  let alreadyImported = false;
  await store.edit(current => {
    if (!isMap(current) || current['schema'] !== 1) throw new Error('Unsupported Reddit state schema during legacy import');
    const migration = child(current, 'migration');
    const prior = migration['legacyReddit'];
    if (isMap(prior)) {
      const oldComment = prior['commentHash'];
      const oldSubmission = prior['submissionHash'];
      if (oldComment === commentHash && oldSubmission === submissionHash) {
        alreadyImported = true;
        return current;
      }
      throw new Error('Legacy Reddit state was already imported from a different frozen snapshot');
    }

    const users = child(current, 'users');
    const warnedLower = new Set(warned.map(value => value.toLowerCase()));
    const bannedLower = new Set(banned.map(value => value.toLowerCase()));
    const allUsers = new Map<string, string>();
    for (const username of [...warned, ...banned]) {
      const key = username.toLowerCase();
      if (!allUsers.has(key)) allUsers.set(key, username);
    }
    for (const [key, username] of allUsers) {
      users[key] = {
        username,
        warned: warnedLower.has(key),
        banned: bannedLower.has(key),
        source: 'legacy-reddit',
      };
    }

    const questions = child(current, 'questions');
    const allQuestionIds = new Set<string>([...titles.keys(), ...markers.keys()]);
    for (const submissionId of allQuestionIds) {
      const existing = questions[submissionId];
      if (isMap(existing)) continue;
      questions[submissionId] = {
        submissionId,
        title: titles.get(submissionId) ?? '',
        markerCommentId: markers.get(submissionId) ?? '',
        bestAnswerCommentId: '',
        createdAt: 0,
        updatedAt: 0,
      };
    }

    const community = child(current, 'community');
    community['titm'] = {
      total: titm,
      leaderboard: jsonObject(leaderboard),
    };
    community['haiku'] = {
      history: jsonObject(haikus),
    };

    migration['legacyReddit'] = {
      commentHash,
      submissionHash,
      importedAt: Math.floor(input.importedAt ?? Date.now() / 1_000),
      warnedUsers: warned.length,
      bannedUsers: banned.length,
      questionMarkers: markers.size,
      submissionQuestions: titles.size,
      leaderboardUsers: leaderboard.size,
      haikuAuthors: haikus.size,
      titm,
    };
    return current;
  });

  return {
    commentHash,
    submissionHash,
    warnedUsers: warned.length,
    bannedUsers: banned.length,
    questions: markers.size,
    submissionQuestions: titles.size,
    leaderboardUsers: leaderboard.size,
    haikuAuthors: haikus.size,
    titm,
    alreadyImported,
  };
};
