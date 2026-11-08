import { createHash } from 'node:crypto';
import type { Community } from './postFeed.ts';
import type { MutationDeduplication, ClaimResult } from './modmailMutation.ts';

type Json = null | boolean | number | string | Json[] | { readonly [key: string]: Json };
type Fields = Readonly<Record<string, Json>>;

type WriteBase = {
  readonly subreddit: Community;
  readonly operationId: string;
  readonly expectedAuthor: string;
};
export type AuthoredRequest = WriteBase & (
  | { readonly action: 'self-post'; readonly title: string; readonly body: string;
      readonly flairTemplateId: string | null }
  | { readonly action: 'private-message'; readonly recipient: string; readonly subject: string;
      readonly body: string }
);
export type AuthoredApi = {
  getAppUsername(): Promise<string | null>;
  submitSelf(options: {
    readonly subredditName: string; readonly title: string; readonly text: string;
    readonly sendreplies: true; readonly runAs: 'APP'; readonly flairId?: string;
  }): Promise<{ readonly id: string; readonly subredditName: string; readonly authorName: string }>;
  sendPrivateMessage(options: {
    readonly to: string; readonly subject: string; readonly text: string;
  }): Promise<void>;
};
export type AuthoredReceipt = {
  readonly protocol: 1;
  readonly operationId: string;
  readonly status: 'applied' | 'already-applied';
  readonly postId?: string;
};
const operationPattern = /^[a-z0-9_-]{10,96}$/iu;
const namePattern = /^[a-z0-9_-]{2,32}$/iu;
const templatePattern = /^[0-9a-z_-]{8,96}$/iu;
const postPattern = /^t3_[a-z0-9]+$/iu;
const exact = (fields: Fields, keys: readonly string[]): void => {
  if (Object.keys(fields).some(key => !keys.includes(key))) {
    throw new Error('Unexpected authored-write field');
  }
};
const field = (raw: Fields, key: string, max: number): string => {
  const value = raw[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new Error('Invalid authored-write ' + key);
  }
  return value;
};
const parsePost = (raw: Fields, base: WriteBase): AuthoredRequest => {
  exact(raw,['action','subreddit','operationId','expectedAuthor','title','body','flairTemplateId']);
  const title = field(raw,'title',300);
  const body = field(raw,'body',40_000);
  const flairTemplateId = raw['flairTemplateId'];
  if (flairTemplateId !== null && (typeof flairTemplateId !== 'string'
    || !templatePattern.test(flairTemplateId))) {
    throw new Error('Invalid post flair template ID');
  }
  return {...base,action:'self-post',title,body,flairTemplateId};
};
const parseMessage = (raw: Fields, base: WriteBase): AuthoredRequest => {
  exact(raw,['action','subreddit','operationId','expectedAuthor','recipient','subject','body']);
  const recipient=field(raw,'recipient',32);
  if (!namePattern.test(recipient)) throw new Error('Invalid private message recipient');
  return {
    ...base, action:'private-message', recipient,
    subject:field(raw,'subject',100), body:field(raw,'body',10_000),
  };
};
export const parseAuthoredRequest = (raw: Json): AuthoredRequest => {
  if (raw === null || Array.isArray(raw) || typeof raw !== 'object') {
    throw new Error('Invalid authored-write request');
  }
  const subreddit = raw['subreddit'];
  if (subreddit !== 'catgirlcoin' && subreddit !== 'nyaonearth') {
    throw new Error('Invalid authored-write community');
  }
  const operationId = field(raw,'operationId',96);
  if (!operationPattern.test(operationId)) throw new Error('Invalid authored-write operation ID');
  const expectedAuthor = field(raw,'expectedAuthor',32);
  if (!namePattern.test(expectedAuthor)) throw new Error('Invalid expected author username');
  const base: WriteBase={subreddit,operationId,expectedAuthor};
  const action = raw['action'];
  if (action === 'self-post') return parsePost(raw,base);
  if (action === 'private-message') return parseMessage(raw,base);
  throw new Error('Unsupported authored-write operation');
};
export const verifyAuthoredIdentity = (actual: string | null, expected: string): void => {
  if (actual === null || actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error('Devvit app cannot impersonate the required Reddit publisher');
  }
};
const priorReceipt = (request: AuthoredRequest): AuthoredReceipt => {
  if (request.action === 'self-post') {
    throw new Error('Original native post ID requires reconciliation');
  }
  return {protocol:1,operationId:request.operationId,status:'already-applied'};
};
const perform = async (
  request: AuthoredRequest, api: AuthoredApi, installed: string,
): Promise<string | null> => {
  if (request.action === 'private-message') {
    await api.sendPrivateMessage({to:request.recipient,subject:request.subject,text:request.body});
    return null;
  }
  const result = await api.submitSelf({
    subredditName:installed, title:request.title, text:request.body,
    sendreplies:true, runAs:'APP',
    ...(request.flairTemplateId===null?{}:{flairId:request.flairTemplateId}),
  });
  if (!postPattern.test(result.id) || result.subredditName.toLowerCase() !== request.subreddit
    || result.authorName.toLowerCase() !== request.expectedAuthor.toLowerCase()) {
    throw new Error('Submitted post identity or author did not match the canonical request');
  }
  return result.id;
};
export const executeAuthoredWrite = async (
  request: AuthoredRequest, installed: string, api: AuthoredApi,
  claims: MutationDeduplication,
): Promise<AuthoredReceipt> => {
  if (installed.toLowerCase() !== request.subreddit) {
    throw new Error('Authored-write installation mismatch');
  }
  verifyAuthoredIdentity(await api.getAppUsername(),request.expectedAuthor);
  const fingerprint=createHash('sha256').update(JSON.stringify(request)).digest('hex');
  const claim:ClaimResult=await claims.claim(request.operationId,fingerprint);
  if (claim === 'conflict') throw new Error('Canonical authored operation ID reused');
  if (claim === 'pending') throw new Error('Authored operation outcome requires reconciliation');
  if (claim === 'applied') return priorReceipt(request);
  const postId=await perform(request,api,installed);
  await claims.complete(request.operationId,fingerprint);
  return postId===null
    ? {protocol:1,operationId:request.operationId,status:'applied'}
    : {protocol:1,operationId:request.operationId,status:'applied',postId};
};
