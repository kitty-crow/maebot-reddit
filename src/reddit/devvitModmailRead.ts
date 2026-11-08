import { parseMap } from '../types/json.ts';
import { mapVal } from '../types/value.ts';
import { modmailConversation, modmailConversations } from '../modmail/decode.ts';
import type { ModmailConversation, ModmailConversationPage } from '../modmail/types.ts';
import type { DevvitCommunity } from './devvitPostFeed.ts';

export type DevvitModmailPageRequest = {
  readonly subreddit: DevvitCommunity;
  readonly limit: number;
  readonly after: string | null;
};

const envelope = (body: string, subreddit: DevvitCommunity, mode: 'list' | 'detail') => {
  if (body.length > 2_097_152) throw new Error('Devvit Modmail response too large');
  const root = parseMap(body);
  if (root['protocol'] !== 1 || root['mode'] !== mode || root['subreddit'] !== subreddit) {
    throw new Error('Devvit Modmail protocol or installation mismatch');
  }
  return mapVal(root['data'], 'Devvit Modmail data');
};
const sameCommunity = (actual: string, expected: DevvitCommunity): boolean =>
  actual.toLowerCase() === expected;

export const parseDevvitModmailPage = (
  body: string,
  request: DevvitModmailPageRequest,
): ModmailConversationPage => {
  const page = modmailConversations(envelope(body, request.subreddit, 'list'));
  if (page.conversations.length > request.limit) throw new Error('Devvit Modmail page exceeded limit');
  if (page.after !== null && page.after === request.after) throw new Error('Devvit Modmail cursor did not advance');
  for (const conversation of page.conversations) {
    if (!sameCommunity(conversation.subreddit, request.subreddit)) {
      throw new Error('Devvit Modmail conversation from another community');
    }
  }
  return page;
};

export const parseDevvitModmailDetail = (
  body: string,
  subreddit: DevvitCommunity,
  conversationId: string,
): ModmailConversation => {
  const data = envelope(body, subreddit, 'detail');
  const conversation = modmailConversation(data);
  if (conversation.id !== conversationId || !sameCommunity(conversation.subreddit, subreddit)) {
    throw new Error('Devvit Modmail conversation identity mismatch');
  }
  return conversation;
};
