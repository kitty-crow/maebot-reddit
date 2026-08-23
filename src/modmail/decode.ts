import { isMap, type Json, type JsonMap } from '../types/json.ts';
import type {
  ModmailConversation,
  ModmailConversationKind,
  ModmailConversationPage,
  ModmailConversationState,
  ModmailMessage,
  ModmailParticipant,
} from './types.ts';

const text = (value: Json | undefined): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const bool = (value: Json | undefined): boolean => value === true;

const objectValues = (value: Json | undefined): readonly JsonMap[] => {
  if (!isMap(value)) return [];
  return Object.values(value).filter((item): item is JsonMap => isMap(item));
};

const epochSeconds = (value: Json | undefined): number => {
  if (typeof value !== 'string' || value.trim().length === 0) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1_000) : 0;
};

const participant = (value: Json | undefined): ModmailParticipant | null => {
  if (!isMap(value)) return null;
  return {
    id: text(value['id']),
    name: text(value['name']),
    isModerator: bool(value['isMod']),
    isAdmin: bool(value['isAdmin']),
    isParticipant: bool(value['isParticipant']),
    isHidden: bool(value['isHidden']),
    isDeleted: bool(value['isDeleted']),
  };
};

const state = (value: Json | undefined): ModmailConversationState => {
  if (typeof value === 'string') {
    if (
      value === 'new' || value === 'inprogress' || value === 'archived'
      || value === 'appeals' || value === 'join_requests' || value === 'filtered'
    ) return value;
    return 'unknown';
  }
  if (value === 0) return 'new';
  if (value === 1) return 'inprogress';
  if (value === 2) return 'archived';
  if (value === 3) return 'appeals';
  if (value === 4) return 'join_requests';
  if (value === 5) return 'filtered';
  return 'unknown';
};

const kind = (value: Json | undefined): ModmailConversationKind => {
  if (value === 'sr_user' || value === 'sr_sr' || value === 'internal') return value;
  return 'unknown';
};

const message = (conversationId: string, value: JsonMap): ModmailMessage | null => {
  const id = text(value['id']);
  if (id === null) return null;
  return {
    id,
    conversationId,
    author: participant(value['author']),
    bodyMarkdown: text(value['bodyMarkdown']) ?? text(value['body']) ?? '',
    createdAt: epochSeconds(value['date']),
    isInternal: bool(value['isInternal']),
    participatingAs: text(value['participatingAs']),
  };
};

const messageIds = (value: JsonMap): readonly string[] => {
  const objIds = value['objIds'];
  if (!Array.isArray(objIds)) return [];
  const ids: string[] = [];
  for (const raw of objIds) {
    if (!isMap(raw) || raw['key'] !== 'messages') continue;
    const id = text(raw['id']);
    if (id !== null) ids.push(id);
  }
  return ids;
};

const subredditName = (value: JsonMap): string => {
  const subreddit = value['subreddit'];
  if (isMap(subreddit)) return text(subreddit['displayName']) ?? text(subreddit['name']) ?? '';
  const owner = value['owner'];
  if (isMap(owner)) return text(owner['displayName']) ?? text(owner['name']) ?? '';
  return '';
};

const conversation = (
  value: JsonMap,
  topMessages: ReadonlyMap<string, JsonMap>,
): ModmailConversation | null => {
  const id = text(value['id']);
  if (id === null) return null;
  const nestedMessages = new Map<string, JsonMap>();
  for (const raw of objectValues(value['messages'])) {
    const messageId = text(raw['id']);
    if (messageId !== null) nestedMessages.set(messageId, raw);
  }
  const ids = messageIds(value);
  const source = ids.length > 0
    ? ids.map(messageId => nestedMessages.get(messageId) ?? topMessages.get(messageId)).filter((raw): raw is JsonMap => raw !== undefined)
    : [...nestedMessages.values()];
  const messages = source
    .map(raw => message(id, raw))
    .filter((item): item is ModmailMessage => item !== null)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return {
    id,
    subreddit: subredditName(value),
    subject: text(value['subject']) ?? '',
    participant: participant(value['participant']),
    kind: kind(value['conversationType']),
    state: state(value['state']),
    isInternal: bool(value['isInternal']),
    isAuto: bool(value['isAuto']),
    lastUpdatedAt: epochSeconds(value['lastUpdated']),
    messages,
  };
};

export const modmailConversations = (raw: Json): ModmailConversationPage => {
  if (!isMap(raw)) throw new Error('Reddit modmail response must be an object');
  const topMessages = new Map<string, JsonMap>();
  for (const value of objectValues(raw['messages'])) {
    const id = text(value['id']);
    if (id !== null) topMessages.set(id, value);
  }
  const values = objectValues(raw['conversations']);
  const conversations = values
    .map(value => conversation(value, topMessages))
    .filter((item): item is ModmailConversation => item !== null)
    .sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt || a.id.localeCompare(b.id));
  return { conversations, after: text(raw['after']) };
};

export const modmailConversation = (raw: Json): ModmailConversation => {
  if (!isMap(raw)) throw new Error('Reddit modmail conversation response must be an object');
  const direct = raw['conversation'];
  if (isMap(direct)) {
    const decoded = conversation(direct, new Map());
    if (decoded !== null) return decoded;
  }
  const page = modmailConversations(raw);
  const first = page.conversations[0];
  if (first === undefined) throw new Error('Reddit modmail conversation response contained no conversation');
  return first;
};
