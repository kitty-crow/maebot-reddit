import { createHash } from 'node:crypto';
import type { Community } from './postFeed.ts';
import type { MutationDeduplication, ClaimResult } from './modmailMutation.ts';

type Json = null | boolean | number | string | Json[] | { readonly [key: string]: Json };
type JsonObject = { readonly [key: string]: Json };
export type NoteLabel = 'NONE' | 'HELPFUL_USER' | 'SOLID_CONTRIBUTOR'
  | 'SPAM_WATCH' | 'SPAM_WARNING' | 'ABUSE_WARNING';
export type NoteRequest =
  | { readonly subreddit: Community; readonly kind: 'list'; readonly username: string; readonly limit: number }
  | { readonly subreddit: Community; readonly kind: 'add'; readonly username: string;
      readonly operationId: string; readonly note: string; readonly label: NoteLabel; readonly redditId: string | null }
  | { readonly subreddit: Community; readonly kind: 'delete'; readonly username: string;
      readonly operationId: string; readonly noteId: string };

export type NoteSource = {
  readonly id: string;
  readonly user: { readonly name?: string | undefined };
  readonly subreddit: { readonly name?: string | undefined };
  readonly createdAt: Date;
  readonly type: string;
  readonly userNote?: { readonly note?: string | undefined; readonly label?: string | undefined } | undefined;
};
export type NoteWire = {
  readonly id: string;
  readonly username: string;
  readonly note: string | null;
  readonly label: string | null;
  readonly createdUtc: number;
};
export type ModNoteApi = {
  addModNote(options: { readonly subreddit: string; readonly user: string; readonly note: string;
    readonly label?: Exclude<NoteLabel, 'NONE'>; readonly redditId?: string }): Promise<{ readonly id: string }>;
  deleteModNote(options: { readonly subreddit: string; readonly user: string; readonly noteId: string }): Promise<boolean>;
};
export type NoteReceipt = {
  readonly protocol: 1;
  readonly operationId: string;
  readonly status: 'applied' | 'already-applied';
  readonly noteId?: string;
};

const labelValues: readonly NoteLabel[] = ['NONE','HELPFUL_USER','SOLID_CONTRIBUTOR',
  'SPAM_WATCH','SPAM_WARNING','ABUSE_WARNING'];
const usernamePattern = /^[a-z0-9_-]{1,32}$/iu;
const noteIdPattern = /^ModNote_[a-z0-9_-]{1,96}$/iu;
const operationPattern = /^[a-z0-9_-]{10,96}$/iu;
const fullnamePattern = /^t[13]_[a-z0-9]+$/iu;

const required = (raw: JsonObject, key: string): string => {
  const value = raw[key];
  if (typeof value !== 'string') throw new Error('Invalid Mod Note ' + key);
  return value;
};
const exactFields = (raw: JsonObject, fields: readonly string[]): void => {
  if (Object.keys(raw).some(key => !fields.includes(key))) throw new Error('Unexpected Mod Note field');
};
const parseAdd = (raw: JsonObject, subreddit: Community, username: string): NoteRequest => {
  exactFields(raw,['subreddit','kind','username','operationId','note','label','redditId']);
  const operationId = required(raw,'operationId');
  if (!operationPattern.test(operationId)) throw new Error('Invalid Mod Note operation ID');
  const note = required(raw,'note').trim();
  if (note.length === 0 || note.length > 250) throw new Error('Invalid Mod Note length');
  const label = raw['label'];
  if (typeof label !== 'string' || !labelValues.includes(label as NoteLabel)) {
    throw new Error('Invalid Mod Note label');
  }
  const redditId = raw['redditId'];
  if (redditId !== null && (typeof redditId !== 'string' || !fullnamePattern.test(redditId))) {
    throw new Error('Invalid Mod Note post or comment ID');
  }
  return { subreddit, kind:'add', username, operationId, note, label: label as NoteLabel, redditId };
};
const parseDelete = (raw: JsonObject, subreddit: Community, username: string): NoteRequest => {
  exactFields(raw,['subreddit','kind','username','operationId','noteId']);
  const operationId = required(raw,'operationId');
  if (!operationPattern.test(operationId)) throw new Error('Invalid Mod Note operation ID');
  const noteId = required(raw,'noteId');
  if (!noteIdPattern.test(noteId)) throw new Error('Invalid native Mod Note ID');
  return { subreddit, kind:'delete', username, operationId, noteId };
};
export const parseModNoteRequest = (raw: Json): NoteRequest => {
  if (raw === null || Array.isArray(raw) || typeof raw !== 'object') throw new Error('Invalid Mod Note request');
  const subreddit = raw['subreddit'];
  if (subreddit !== 'catgirlcoin' && subreddit !== 'nyaonearth') throw new Error('Unknown Mod Note community');
  const username = required(raw,'username');
  if (!usernamePattern.test(username)) throw new Error('Invalid Mod Note username');
  const kind = raw['kind'];
  if (kind === 'add') return parseAdd(raw, subreddit, username);
  if (kind === 'delete') return parseDelete(raw, subreddit, username);
  if (kind !== 'list') throw new Error('Unknown Mod Note request type');
  exactFields(raw,['subreddit','kind','username','limit']);
  const limit = raw['limit'];
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Invalid Mod Note list limit');
  }
  return { subreddit, kind, username, limit };
};
export const projectModNote = (source: NoteSource, subreddit: Community, username: string): NoteWire => {
  if (!noteIdPattern.test(source.id) || source.type !== 'NOTE') throw new Error('Invalid native Mod Note');
  if (source.subreddit.name?.toLowerCase() !== subreddit
    || source.user.name?.toLowerCase() !== username.toLowerCase()) {
    throw new Error('Native Mod Note belongs to another user or community');
  }
  const date = source.createdAt.getTime();
  if (!Number.isFinite(date)) throw new Error('Invalid Mod Note timestamp');
  return {
    id: source.id, username: source.user.name, note: source.userNote?.note ?? null,
    label: source.userNote?.label ?? null, createdUtc: date / 1000,
  };
};
export const executeModNoteWrite = async (
  request: Extract<NoteRequest,{readonly kind:'add'|'delete'}>,
  api: ModNoteApi, claimStore: MutationDeduplication, installed: string,
): Promise<NoteReceipt> => {
  const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  const claim: ClaimResult = await claimStore.claim(request.operationId,fingerprint);
  if (claim === 'conflict') throw new Error('Mod Note operation ID reused');
  if (claim === 'pending') throw new Error('Mod Note write needs reconciliation before retry');
  if (claim === 'applied') return confirmPrevious(request);
  const noteId = await performModNoteWrite(request,api,installed);
  await claimStore.complete(request.operationId,fingerprint);
  return noteId === null
    ? { protocol:1, operationId:request.operationId, status:'applied' }
    : { protocol:1, operationId:request.operationId, status:'applied', noteId };
};
const confirmPrevious = (request: Extract<NoteRequest,{ readonly kind:'add'|'delete' }>): NoteReceipt => {
  if (request.kind === 'add') throw new Error('Previously created Mod Note ID needs reconciliation');
  return { protocol:1, operationId:request.operationId, status:'already-applied' };
};
const performModNoteWrite = async (
  request: Extract<NoteRequest,{readonly kind:'add'|'delete'}>, api: ModNoteApi, installed: string,
): Promise<string | null> => {
  if (request.kind === 'add') return addNote(request,api,installed);
  const deleted = await api.deleteModNote({subreddit:installed,user:request.username,noteId:request.noteId});
  if (!deleted) throw new Error('Reddit did not confirm Mod Note deletion');
  return null;
};
const addNote = async (
  request: Extract<NoteRequest,{ readonly kind:'add'}>, api: ModNoteApi, installed: string,
): Promise<string> => {
  const options = {
    subreddit:installed, user:request.username, note:request.note,
    ...(request.label === 'NONE' ? {} : {label:request.label}),
    ...(request.redditId === null ? {} : {redditId:request.redditId}),
  };
  const created = await api.addModNote(options);
  if (!noteIdPattern.test(created.id)) throw new Error('Reddit returned invalid native Mod Note ID');
  return created.id;
};
