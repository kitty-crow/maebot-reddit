import { createHash } from 'node:crypto';
import type { Community } from './postFeed.ts';

type Json = null | boolean | number | string | Json[] | { readonly [key: string]: Json };
type CommunityIdentity = { readonly id?: string | undefined; readonly subreddit?: { readonly displayName?: string | undefined } | undefined };
type ApiResult = { readonly conversation?: CommunityIdentity | undefined };

export type ModmailMutation =
  | { readonly action: 'reply'; readonly subreddit: Community; readonly operationId: string; readonly conversationId: string;
      readonly body: string; readonly isAuthorHidden: boolean; readonly isInternal: boolean }
  | { readonly action: 'archive' | 'unmute'; readonly subreddit: Community; readonly operationId: string; readonly conversationId: string }
  | { readonly action: 'mute'; readonly subreddit: Community; readonly operationId: string; readonly conversationId: string;
      readonly numHours: 72 | 168 | 672 };

export type ModmailMutationApi = {
  getConversation(params: { readonly conversationId: string; readonly markRead: false }): Promise<ApiResult>;
  reply(params: { readonly conversationId: string; readonly body: string; readonly isAuthorHidden: boolean;
    readonly isInternal: boolean }): Promise<ApiResult>;
  archiveConversation(conversationId: string): Promise<ApiResult>;
  muteConversation(params: { readonly conversationId: string; readonly numHours: 72 | 168 | 672 }): Promise<ApiResult>;
  unmuteConversation(conversationId: string): Promise<ApiResult>;
};
export type ClaimResult = 'acquired' | 'applied' | 'pending' | 'conflict';
export type MutationDeduplication = {
  claim(operationId: string, fingerprint: string): Promise<ClaimResult>;
  complete(operationId: string, fingerprint: string): Promise<void>;
};
export type MutationReceipt = {
  readonly protocol: 1;
  readonly operationId: string;
  readonly status: 'applied' | 'already-applied';
};

const idPattern = /^[a-z0-9]{1,64}$/iu;
const operationPattern = /^[a-z0-9_-]{10,96}$/iu;
const validId = (value: string): boolean => idPattern.test(value);
const requiredText = (value: Json | undefined, field: string): string => {
  if (typeof value !== 'string') throw new Error('Invalid Modmail ' + field);
  return value;
};
const assertKeys = (raw: Readonly<Record<string, Json>>, allowed: readonly string[]): void => {
  if (Object.keys(raw).some(key => !allowed.includes(key))) throw new Error('Unsupported Modmail mutation field');
};

const parseMuteMutation = (
  raw: Readonly<Record<string, Json>>,
  subreddit: Community,
  conversationId: string,
  operationId: string,
  base: readonly string[],
): ModmailMutation => {
  assertKeys(raw, [...base, 'numHours']);
  const numHours = raw['numHours'];
  if (numHours !== 72 && numHours !== 168 && numHours !== 672) throw new Error('Invalid Modmail mute duration');
  return { action: 'mute', subreddit, conversationId, operationId, numHours };
};

export const parseModmailMutation = (raw: Json): ModmailMutation => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Expected a Modmail mutation object');
  const subreddit = raw['subreddit'];
  if (subreddit !== 'catgirlcoin' && subreddit !== 'nyaonearth') throw new Error('Unknown Modmail community');
  const conversationId = requiredText(raw['conversationId'], 'conversationId');
  if (!validId(conversationId)) throw new Error('Invalid Modmail conversationId');
  const operationId = requiredText(raw['operationId'], 'operationId');
  if (!operationPattern.test(operationId)) throw new Error('Invalid Modmail operationId');
  const action = raw['action'];
  const base = ['subreddit', 'conversationId', 'operationId', 'action'];
  if (action === 'archive' || action === 'unmute') {
    assertKeys(raw, base);
    return { action, subreddit, conversationId, operationId };
  }
  if (action === 'mute') return parseMuteMutation(raw, subreddit, conversationId, operationId, base);
  if (action !== 'reply') throw new Error('Unsupported Modmail mutation action');
  assertKeys(raw, [...base, 'body', 'isAuthorHidden', 'isInternal']);
  const body = requiredText(raw['body'], 'body').trim();
  if (body.length === 0 || body.length > 10_000) throw new Error('Invalid Modmail reply length');
  const isAuthorHidden = raw['isAuthorHidden'];
  const isInternal = raw['isInternal'];
  if (typeof isAuthorHidden !== 'boolean' || typeof isInternal !== 'boolean') {
    throw new Error('Missing Modmail reply visibility flags');
  }
  return { action, subreddit, conversationId, operationId, body, isAuthorHidden, isInternal };
};

const verifyConversation = (response: ApiResult, request: ModmailMutation): void => {
  const owner = response.conversation?.subreddit?.displayName;
  const id = response.conversation?.id;
  if (id !== request.conversationId || owner?.toLowerCase() !== request.subreddit) {
    throw new Error('Modmail response conversation identity mismatch');
  }
};

const perform = (api: ModmailMutationApi, request: ModmailMutation): Promise<ApiResult> => {
  switch (request.action) {
    case 'reply':
      return api.reply({
        conversationId: request.conversationId,
        body: request.body,
        isAuthorHidden: request.isAuthorHidden,
        isInternal: request.isInternal,
      });
    case 'archive': return api.archiveConversation(request.conversationId);
    case 'mute': return api.muteConversation({ conversationId: request.conversationId, numHours: request.numHours });
    case 'unmute': return api.unmuteConversation(request.conversationId);
  }
};

export const executeModmailMutation = async (
  request: ModmailMutation,
  api: ModmailMutationApi,
  dedupe: MutationDeduplication,
): Promise<MutationReceipt> => {
  // Read before claiming: a wrong-community or missing conversation never consumes a key.
  verifyConversation(await api.getConversation({ conversationId: request.conversationId, markRead: false }), request);
  const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  const claim = await dedupe.claim(request.operationId, fingerprint);
  if (claim === 'conflict') throw new Error('Modmail operation ID reused with different content');
  if (claim === 'pending') throw new Error('Modmail operation outcome requires reconciliation');
  if (claim === 'applied') {
    return { protocol: 1, operationId: request.operationId, status: 'already-applied' };
  }
  // No retry on failure. The persistent claim remains pending after ambiguous writes.
  const result = await perform(api, request);
  verifyConversation(result, request);
  await dedupe.complete(request.operationId, fingerprint);
  return { protocol: 1, operationId: request.operationId, status: 'applied' };
};
