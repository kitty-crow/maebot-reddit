import { createHash } from 'node:crypto';
import type { Community } from './postFeed.ts';
import type { MutationDeduplication, ClaimResult } from './modmailMutation.ts';

type Json = null | boolean | number | string | Json[] | { readonly [key: string]: Json };
type JsonObject = { readonly [key: string]: Json };
export type ModerationAction =
  | 'ban' | 'unban' | 'unmute' | 'remove'
  | 'set-user-flair' | 'set-user-flair-direct' | 'set-post-flair'
  | 'create-flair-template';

type Base = { readonly subreddit: Community; readonly operationId: string };
export type ModerationMutation = Base & (
  | { readonly action: 'ban'; readonly username: string; readonly reason: string; readonly note: string }
  | { readonly action: 'unban' | 'unmute'; readonly username: string }
  | { readonly action: 'remove'; readonly fullname: string }
  | { readonly action: 'set-user-flair'; readonly username: string; readonly templateId: string; readonly customText: string | null }
  | { readonly action: 'set-user-flair-direct'; readonly username: string; readonly flairText: string | null; readonly cssClass: string | null }
  | { readonly action: 'set-post-flair'; readonly postId: string; readonly templateId: string; readonly customText: string | null }
  | { readonly action: 'create-flair-template'; readonly kind: 'user' | 'post'; readonly template: FlairInput }
);
export type FlairInput = {
  readonly text: string;
  readonly modOnly: boolean;
  readonly textEditable: boolean;
  readonly backgroundColour: string | null;
  readonly textColour: 'light' | 'dark' | null;
  readonly allowableContent: 'all' | 'text' | 'emoji' | null;
  readonly maxEmojis: number | null;
};
export type ModerationApi = {
  readonly isModerator: (username: string) => Promise<boolean>;
  readonly getThingCommunity: (fullname: string) => Promise<string>;
  readonly banUser: (input: { readonly username: string; readonly subredditName: string;
    readonly reason: string; readonly note: string }) => Promise<void>;
  readonly unbanUser: (username: string, subreddit: string) => Promise<void>;
  readonly unmuteUser: (username: string, subreddit: string) => Promise<void>;
  readonly remove: (fullname: string) => Promise<void>;
  readonly setUserFlair: (input: { readonly username: string; readonly subredditName: string;
    readonly flairTemplateId: string; readonly text?: string }) => Promise<void>;
  readonly setUserFlairDirect: (input: { readonly username: string; readonly subredditName: string;
    readonly text: string; readonly cssClass: string }) => Promise<void>;
  readonly setPostFlair: (input: { readonly postId: string; readonly subredditName: string;
    readonly flairTemplateId: string; readonly text?: string }) => Promise<void>;
  readonly createFlairTemplate: (input: { readonly subredditName: string; readonly kind: 'user' | 'post';
    readonly template: FlairInput }) => Promise<string>;
};
export type MutationReceipt = {
  readonly protocol: 1;
  readonly operationId: string;
  readonly status: 'applied' | 'already-applied';
  readonly createdTemplateId?: string;
};

const keyPattern = /^[a-z0-9_-]{10,96}$/iu;
const userPattern = /^[a-z0-9_-]{2,32}$/iu;
const thingPattern = /^t[13]_[a-z0-9]+$/iu;
const templatePattern = /^[0-9a-f-]{8,64}$/iu;
const required = (raw: JsonObject, key: string): string => {
  const value = raw[key];
  if (typeof value !== 'string') throw new Error('Invalid moderation ' + key);
  return value;
};
const optional = (raw: JsonObject, key: string): string | null => {
  const value = raw[key];
  if (value !== null && typeof value !== 'string') throw new Error('Invalid moderation ' + key);
  return value;
};
const exact = (raw: JsonObject, keys: readonly string[]): void => {
  if (Object.keys(raw).some(key => !keys.includes(key))) throw new Error('Unexpected moderation field');
};
const user = (raw: JsonObject): string => {
  const name = required(raw, 'username');
  if (!userPattern.test(name)) throw new Error('Invalid Reddit username');
  return name;
};
const templateId = (raw: JsonObject): string => {
  const id = required(raw, 'templateId');
  if (!templatePattern.test(id)) throw new Error('Invalid flair template ID');
  return id;
};
const bodyText = (raw: JsonObject, key: string, limit: number): string => {
  const value = required(raw, key);
  if (value.length > limit) throw new Error('Moderation text exceeds limit');
  return value;
};
const readFlairInput = (raw: Json): FlairInput => {
  if (raw === null || Array.isArray(raw) || typeof raw !== 'object') throw new Error('Invalid flair template');
  exact(raw, ['text','modOnly','textEditable','backgroundColour','textColour','allowableContent','maxEmojis']);
  const text = bodyText(raw, 'text', 64);
  const modOnly = raw['modOnly'];
  const textEditable = raw['textEditable'];
  const backgroundColour = optional(raw, 'backgroundColour');
  const textColour = raw['textColour'];
  const allowableContent = raw['allowableContent'];
  const maxEmojis = raw['maxEmojis'];
  if (typeof modOnly !== 'boolean' || typeof textEditable !== 'boolean') throw new Error('Missing flair flags');
  if (textColour !== null && textColour !== 'light' && textColour !== 'dark') throw new Error('Invalid flair text colour');
  if (allowableContent !== null && allowableContent !== 'all' && allowableContent !== 'text' && allowableContent !== 'emoji') throw new Error('Invalid flair content');
  if (maxEmojis !== null && (typeof maxEmojis !== 'number' || !Number.isInteger(maxEmojis) || maxEmojis < 1 || maxEmojis > 10)) {
    throw new Error('Invalid maximum flair emojis');
  }
  if (backgroundColour !== null && !/^(?:transparent|#[0-9a-f]{6})$/iu.test(backgroundColour)) {
    throw new Error('Invalid flair background colour');
  }
  return { text, modOnly, textEditable, backgroundColour, textColour, allowableContent, maxEmojis };
};

export const parseModerationMutation = (raw: Json): ModerationMutation => {
  if (raw === null || Array.isArray(raw) || typeof raw !== 'object') throw new Error('Invalid moderation request');
  const subreddit = raw['subreddit'];
  if (subreddit !== 'catgirlcoin' && subreddit !== 'nyaonearth') throw new Error('Unknown community');
  const operationId = required(raw, 'operationId');
  if (!keyPattern.test(operationId)) throw new Error('Invalid operation ID');
  const base: Base = { subreddit, operationId };
  const keys = ['subreddit', 'operationId', 'action'];
  const action = raw['action'];
  if (action === 'ban') return parseBan(raw, base, keys);
  if (action === 'unban' || action === 'unmute') {
    exact(raw, [...keys, 'username']);
    return { ...base, action, username: user(raw) };
  }
  if (action === 'remove') return parseRemove(raw, base, keys);
  if (action === 'set-user-flair') return parseUserTemplate(raw, base, keys);
  if (action === 'set-user-flair-direct') return parseUserDirect(raw, base, keys);
  if (action === 'set-post-flair') return parsePostTemplate(raw, base, keys);
  if (action === 'create-flair-template') return parseTemplate(raw, base, keys);
  throw new Error('Unsupported moderation action');
};
const parseRemove = (raw: JsonObject, base: Base, keys: readonly string[]): ModerationMutation => {
  exact(raw, [...keys, 'fullname']);
  const fullname = required(raw, 'fullname');
  if (!thingPattern.test(fullname)) throw new Error('Invalid Reddit fullname');
  return { ...base, action: 'remove', fullname };
};
const parseBan = (raw: JsonObject, base: Base, keys: readonly string[]): ModerationMutation => {
  exact(raw, [...keys, 'username', 'reason', 'note']);
  return { ...base, action: 'ban', username: user(raw),
    reason: bodyText(raw, 'reason', 100), note: bodyText(raw, 'note', 300) };
};
const parseUserTemplate = (raw: JsonObject, base: Base, keys: readonly string[]): ModerationMutation => {
  exact(raw, [...keys,'username','templateId','customText']);
  const customText = optional(raw, 'customText');
  if (customText !== null && customText.length > 64) throw new Error('Custom flair text too long');
  return { ...base, action: 'set-user-flair', username: user(raw), templateId: templateId(raw), customText };
};
const parseUserDirect = (raw: JsonObject, base: Base, keys: readonly string[]): ModerationMutation => {
  exact(raw, [...keys,'username','flairText','cssClass']);
  const flairText = optional(raw,'flairText');
  const cssClass = optional(raw,'cssClass');
  if (flairText !== null && flairText.length > 64) throw new Error('User flair too long');
  if (cssClass !== null && cssClass.length > 100) throw new Error('Flair CSS class too long');
  return { ...base, action:'set-user-flair-direct', username:user(raw), flairText, cssClass };
};
const parsePostTemplate = (raw: JsonObject, base: Base, keys: readonly string[]): ModerationMutation => {
  exact(raw, [...keys,'postId','templateId','customText']);
  const postId = required(raw, 'postId');
  if (!/^t3_[a-z0-9]+$/iu.test(postId)) throw new Error('Invalid post fullname');
  const customText = optional(raw, 'customText');
  if (customText !== null && customText.length > 64) throw new Error('Post flair text too long');
  return { ...base, action: 'set-post-flair', postId, templateId:templateId(raw), customText };
};
const parseTemplate = (raw: JsonObject, base: Base, keys: readonly string[]): ModerationMutation => {
  exact(raw, [...keys,'kind','template']);
  const kind = raw['kind'];
  if (kind !== 'user' && kind !== 'post') throw new Error('Invalid flair kind');
  return { ...base, action: 'create-flair-template', kind, template: readFlairInput(raw['template'] ?? null) };
};

const targetName = (request: ModerationMutation): string | null => {
  switch(request.action) {
    case 'ban':
    case 'unban':
    case 'unmute':
    case 'set-user-flair':
    case 'set-user-flair-direct': return request.username;
    default: return null;
  }
};
const thingId = (request: ModerationMutation): string | null => {
  switch(request.action) {
    case 'remove': return request.fullname;
    case 'set-post-flair': return request.postId;
    default: return null;
  }
};
const preflight = async (request: ModerationMutation, api: ModerationApi): Promise<void> => {
  const name = targetName(request);
  if (name !== null && await api.isModerator(name)) throw new Error('Refusing to modify a moderator');
  const id = thingId(request);
  if (id !== null && (await api.getThingCommunity(id)).toLowerCase() !== request.subreddit) {
    throw new Error('Moderation target is outside installed community');
  }
};
const perform = async (request: ModerationMutation, api: ModerationApi): Promise<string | null> => {
  switch(request.action) {
    case 'ban':
      await api.banUser({ subredditName:request.subreddit, username:request.username, reason:request.reason, note:request.note });
      return null;
    case 'unban': await api.unbanUser(request.username, request.subreddit); return null;
    case 'unmute': await api.unmuteUser(request.username, request.subreddit); return null;
    case 'remove': await api.remove(request.fullname); return null;
    case 'set-user-flair':
      await api.setUserFlair({ username:request.username, subredditName:request.subreddit,
        flairTemplateId:request.templateId, ...(request.customText === null ? {} : { text:request.customText }) });
      return null;
    case 'set-user-flair-direct':
      await api.setUserFlairDirect({ username:request.username, subredditName:request.subreddit,
        text:request.flairText ?? '', cssClass:request.cssClass ?? '' });
      return null;
    case 'set-post-flair':
      await api.setPostFlair({ postId:request.postId, subredditName:request.subreddit,
        flairTemplateId:request.templateId, ...(request.customText === null ? {} : { text:request.customText }) });
      return null;
    case 'create-flair-template':
      return await api.createFlairTemplate({ subredditName:request.subreddit, kind:request.kind, template:request.template });
  }
};
export const executeModerationMutation = async (
  request: ModerationMutation, api: ModerationApi, claims: MutationDeduplication,
): Promise<MutationReceipt> => {
  await preflight(request, api);
  const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  const claim: ClaimResult = await claims.claim(request.operationId, fingerprint);
  if (claim === 'conflict') throw new Error('Moderation operation ID reused with different content');
  if (claim === 'pending') throw new Error('Moderation outcome uncertain; reconcile before retry');
  if (claim === 'applied') return { protocol:1, operationId:request.operationId, status:'already-applied' };
  const createdTemplateId = await perform(request, api);
  await claims.complete(request.operationId, fingerprint);
  return createdTemplateId === null
    ? { protocol:1, operationId:request.operationId, status:'applied' }
    : { protocol:1, operationId:request.operationId, status:'applied', createdTemplateId };
};
