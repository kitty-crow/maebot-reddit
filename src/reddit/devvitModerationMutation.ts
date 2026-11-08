import { parseMap } from '../types/json.ts';
import { strVal } from '../types/value.ts';
import type { DevvitCommunity } from './devvitPostFeed.ts';

type Base = { readonly subreddit: DevvitCommunity; readonly operationId: string };
export type DevvitModerationRequest = Base & (
  | { readonly action: 'ban'; readonly username: string; readonly reason: string; readonly note: string }
  | { readonly action: 'unban' | 'unmute'; readonly username: string }
  | { readonly action: 'remove'; readonly fullname: string }
  | { readonly action: 'set-user-flair'; readonly username: string; readonly templateId: string; readonly customText: string | null }
  | { readonly action: 'set-user-flair-direct'; readonly username: string; readonly flairText: string | null; readonly cssClass: string | null }
  | { readonly action: 'set-post-flair'; readonly postId: string; readonly templateId: string; readonly customText: string | null }
  | { readonly action: 'create-flair-template'; readonly kind: 'user' | 'post'; readonly template: DevvitFlairInput }
);
export type DevvitFlairInput = {
  readonly text: string; readonly modOnly: boolean; readonly textEditable: boolean;
  readonly backgroundColour: string | null; readonly textColour: 'light' | 'dark' | null;
  readonly allowableContent: 'all' | 'emoji' | 'text' | null; readonly maxEmojis: number | null;
};
export type DevvitModerationReceipt = {
  readonly protocol: 1; readonly operationId: string;
  readonly status: 'applied' | 'already-applied'; readonly createdTemplateId?: string;
};
const operationPattern = /^[a-z0-9_-]{10,96}$/iu;
export const validateDevvitModerationRequest = (request: DevvitModerationRequest): void => {
  if (request.subreddit !== 'catgirlcoin' && request.subreddit !== 'nyaonearth') throw new Error('Invalid community');
  if (!operationPattern.test(request.operationId)) throw new Error('Invalid canonical operation ID');
};
export const parseDevvitModerationReceipt = (body: string, operationId: string): DevvitModerationReceipt => {
  if (body.length > 4096) throw new Error('Oversized Devvit moderation receipt');
  const root = parseMap(body);
  if (root['protocol'] !== 1 || root['operationId'] !== operationId) {
    throw new Error('Devvit moderation receipt does not match canonical operation');
  }
  const status = root['status'];
  if (status !== 'applied' && status !== 'already-applied') {
    throw new Error('Unrecognised moderation operation status');
  }
  const createdTemplateId = root['createdTemplateId'];
  if (createdTemplateId !== undefined) {
    const id = strVal(createdTemplateId, 'created flair template ID');
    if (id.length < 8 || id.length > 64) throw new Error('Invalid created flair template ID');
    return { protocol: 1, operationId, status, createdTemplateId: id };
  }
  return { protocol: 1, operationId, status };
};
