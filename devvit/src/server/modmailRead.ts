import type { Community } from './postFeed.ts';

type Json = null | boolean | number | string | Json[] | { readonly [key: string]: Json };

export type ModmailReadRequest =
  | { readonly subreddit: Community; readonly mode: 'list'; readonly limit: number; readonly after: string | null }
  | { readonly subreddit: Community; readonly mode: 'detail'; readonly conversationId: string };

export type ConversationSource = {
  readonly id?: string | undefined;
  readonly state?: string | undefined;
  readonly subreddit?: { readonly displayName?: string | undefined } | undefined;
};
export type ConversationPageSource<T extends ConversationSource> = {
  readonly conversationIds: readonly string[];
  readonly conversations: Readonly<Record<string, T>>;
};

const conversationIdPattern = /^[a-z0-9]+$/iu;
const isConversationId = (value: string): boolean =>
  conversationIdPattern.test(value) && value.length <= 64;

export const parseModmailReadRequest = (raw: Json): ModmailReadRequest => {
  if (raw === null || Array.isArray(raw) || typeof raw !== 'object') {
    throw new Error('Invalid Modmail request object');
  }
  const subreddit = raw['subreddit'];
  if (subreddit !== 'catgirlcoin' && subreddit !== 'nyaonearth') throw new Error('Unknown Modmail community');
  const mode = raw['mode'];
  if (mode === 'detail') {
    const conversationId = raw['conversationId'];
    if (typeof conversationId !== 'string' || !isConversationId(conversationId)) {
      throw new Error('Invalid Modmail conversation ID');
    }
    if (raw['markRead'] !== undefined && raw['markRead'] !== false) {
      throw new Error('Read-only Modmail preview cannot mark messages read');
    }
    return { subreddit, mode, conversationId };
  }
  if (mode !== 'list') throw new Error('Unknown Modmail read mode');
  const limit = raw['limit'];
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Invalid Modmail page size');
  }
  const after = raw['after'] ?? null;
  if (after !== null && (typeof after !== 'string' || !isConversationId(after))) {
    throw new Error('Invalid Modmail cursor');
  }
  return { subreddit, mode, limit, after };
};

export const normaliseModmailState = (raw: string | undefined): string => {
  if (raw === undefined) return 'unknown';
  const state = raw.replaceAll('_', '').toLowerCase();
  if (state === 'new' || state === 'inprogress' || state === 'archived'
    || state === 'appeals' || state === 'joinrequests' || state === 'filtered') {
    return state === 'joinrequests' ? 'join_requests' : state;
  }
  throw new Error('Unknown Devvit Modmail state');
};

export const projectModmailConversation = <T extends ConversationSource>(
  source: T,
  subreddit: Community,
): Omit<T, 'id' | 'state'> & { readonly id: string; readonly state: string } => {
  const id = source.id;
  const owner = source.subreddit?.displayName;
  if (typeof id !== 'string' || !isConversationId(id)) throw new Error('Missing Modmail conversation ID');
  if (owner === undefined || owner.toLowerCase() !== subreddit) {
    throw new Error('Modmail conversation belongs to a different community');
  }
  return { ...source, id, state: normaliseModmailState(source.state) };
};

export const projectModmailPage = <T extends ConversationSource>(
  source: ConversationPageSource<T>,
  subreddit: Community,
  limit: number,
): {
  readonly protocol: 1;
  readonly mode: 'list';
  readonly subreddit: Community;
  readonly data: {
    readonly conversations: Readonly<Record<string, Omit<T, 'id' | 'state'> & { readonly id: string; readonly state: string }>>;
    readonly after: string | null;
  };
} => {
  if (source.conversationIds.length > limit) throw new Error('Modmail page exceeds requested limit');
  if (Object.keys(source.conversations).length !== source.conversationIds.length) {
    throw new Error('Modmail page contains unexpected or missing conversations');
  }
  const seen = new Set<string>();
  const conversations: Record<string, Omit<T, 'id' | 'state'> & { readonly id: string; readonly state: string }> = {};
  for (const id of source.conversationIds) {
    if (!isConversationId(id) || seen.has(id)) throw new Error('Invalid or duplicate Modmail cursor');
    seen.add(id);
    const row = source.conversations[id];
    if (row === undefined) throw new Error('Modmail conversation missing from page');
    const value = projectModmailConversation(row, subreddit);
    if (value.id !== id) throw new Error('Modmail conversation ID mismatch');
    conversations[id] = value;
  }
  return {
    protocol: 1,
    mode: 'list',
    subreddit,
    data: {
      conversations,
      after: source.conversationIds.length === limit ? source.conversationIds.at(-1) ?? null : null,
    },
  };
};
