import { parseMap } from '../types/json.ts';
import type { DevvitCommunity } from './devvitPostFeed.ts';

export type DevvitModmailMutation =
  | { readonly subreddit: DevvitCommunity; readonly action: 'reply'; readonly operationId: string;
      readonly conversationId: string; readonly body: string; readonly isAuthorHidden: boolean; readonly isInternal: boolean }
  | { readonly subreddit: DevvitCommunity; readonly action: 'archive' | 'unmute'; readonly operationId: string;
      readonly conversationId: string }
  | { readonly subreddit: DevvitCommunity; readonly action: 'mute'; readonly operationId: string;
      readonly conversationId: string; readonly numHours: 72 | 168 | 672 };

export type DevvitMutationReceipt = {
  readonly protocol: 1;
  readonly operationId: string;
  readonly status: 'applied' | 'already-applied';
};

const operationPattern = /^[a-z0-9_-]{10,96}$/iu;
const conversationPattern = /^[a-z0-9]{1,64}$/iu;

export const validateModmailMutation = (input: DevvitModmailMutation): void => {
  if (input.subreddit !== 'catgirlcoin' && input.subreddit !== 'nyaonearth') throw new Error('Unknown community');
  if (!operationPattern.test(input.operationId)) throw new Error('Invalid canonical operation ID');
  if (!conversationPattern.test(input.conversationId)) throw new Error('Invalid Modmail conversation ID');
  if (input.action === 'reply') validateReply(input);
  if (input.action === 'mute' && input.numHours !== 72 && input.numHours !== 168 && input.numHours !== 672) {
    throw new Error('Invalid Modmail duration');
  }
};

const validateReply = (input: Extract<DevvitModmailMutation, { readonly action: 'reply' }>): void => {
  if (input.body.trim().length === 0 || input.body.length > 10_000) throw new Error('Invalid Modmail reply');
  if (typeof input.isAuthorHidden !== 'boolean' || typeof input.isInternal !== 'boolean') {
    throw new Error('Invalid Modmail reply visibility');
  }
};

export const parseModmailMutationReceipt = (body: string, operationId: string): DevvitMutationReceipt => {
  if (body.length > 4096) throw new Error('Devvit mutation receipt exceeds maximum length');
  const root = parseMap(body);
  if (root['protocol'] !== 1 || root['operationId'] !== operationId) {
    throw new Error('Devvit mutation receipt protocol or operation ID mismatch');
  }
  const status = root['status'];
  if (status !== 'applied' && status !== 'already-applied') throw new Error('Invalid Devvit mutation status');
  return { protocol: 1, operationId, status };
};
