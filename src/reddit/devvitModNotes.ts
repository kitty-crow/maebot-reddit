import { parseMap, type Json } from '../types/json.ts';
import { arrVal, mapVal, numVal, strVal } from '../types/value.ts';
import type { DevvitCommunity } from './devvitPostFeed.ts';

export type NativeModNoteLabel = 'NONE' | 'HELPFUL_USER' | 'SOLID_CONTRIBUTOR'
  | 'SPAM_WATCH' | 'SPAM_WARNING' | 'ABUSE_WARNING';
export type DevvitModNoteRequest =
  | { readonly subreddit: DevvitCommunity; readonly kind: 'add'; readonly username: string;
      readonly operationId: string; readonly note: string; readonly label: NativeModNoteLabel; readonly redditId: string | null }
  | { readonly subreddit: DevvitCommunity; readonly kind: 'delete'; readonly username: string;
      readonly operationId: string; readonly noteId: string };
export type DevvitNativeNote = {
  readonly id: string; readonly username: string; readonly note: string | null;
  readonly label: string | null; readonly createdUtc: number;
};
export type DevvitNoteReceipt = {
  readonly protocol: 1; readonly operationId: string;
  readonly status: 'applied' | 'already-applied'; readonly noteId?: string;
};

const opPattern = /^[a-z0-9_-]{10,96}$/iu;
const noteIdPattern = /^ModNote_[a-z0-9_-]{1,96}$/iu;
const usernamePattern = /^[a-z0-9_-]{1,32}$/iu;
const noteValue = (raw: Json, username: string): DevvitNativeNote => {
  const obj = mapVal(raw,'Devvit native Mod Note');
  const id = strVal(obj['id'],'Mod Note ID');
  if (!noteIdPattern.test(id) || obj['username'] !== username) {
    throw new Error('Unexpected native Mod Note identity');
  }
  const date = numVal(obj['createdUtc'],'Mod Note date');
  if (date < 0) throw new Error('Invalid native Mod Note date');
  const note = obj['note'];
  const label = obj['label'];
  if (note !== null && typeof note !== 'string') throw new Error('Invalid native note body');
  if (label !== null && typeof label !== 'string') throw new Error('Invalid native note label');
  return { id, username, note, label, createdUtc: date };
};
export const validateDevvitNoteWrite = (input: DevvitModNoteRequest): void => {
  if (input.subreddit !== 'catgirlcoin' && input.subreddit !== 'nyaonearth') throw new Error('Invalid note community');
  if (!usernamePattern.test(input.username) || !opPattern.test(input.operationId)) {
    throw new Error('Invalid native Mod Note operation identity');
  }
};
export const parseDevvitNoteListing = (
  body: string, subreddit: DevvitCommunity, username: string, limit: number,
): readonly DevvitNativeNote[] => {
  if (body.length > 131_072) throw new Error('Devvit note listing is too large');
  const root = parseMap(body);
  if (root['protocol'] !== 1 || root['subreddit'] !== subreddit
    || root['kind'] !== 'list' || root['username'] !== username) {
    throw new Error('Devvit note listing mismatched installation or user');
  }
  const notes = arrVal(root['notes'],'Devvit native Mod Notes');
  if (notes.length > limit) throw new Error('Devvit Mod Note listing exceeded limit');
  return notes.map(value => noteValue(value,username));
};
export const parseDevvitNoteReceipt = (
  body: string, request: DevvitModNoteRequest,
): DevvitNoteReceipt => {
  if (body.length > 4096) throw new Error('Oversized Devvit Mod Note receipt');
  const root = parseMap(body);
  if (root['protocol'] !== 1 || root['operationId'] !== request.operationId) {
    throw new Error('Devvit Mod Note receipt identity mismatch');
  }
  const status = root['status'];
  if (status !== 'applied' && status !== 'already-applied') throw new Error('Invalid Mod Note receipt status');
  const noteId = root['noteId'];
  if (request.kind === 'add') return parseAddReceipt(request.operationId, status, noteId);
  if (noteId !== undefined) throw new Error('Unexpected deleted note ID in receipt');
  return { protocol:1, operationId:request.operationId, status };
};
const parseAddReceipt = (
  operationId:string, status:'applied'|'already-applied', raw:Json|undefined,
):DevvitNoteReceipt => {
  const noteId = strVal(raw,'created Mod Note ID');
  if (!noteIdPattern.test(noteId)) throw new Error('Invalid created Mod Note ID');
  return { protocol:1, operationId, status, noteId };
};
