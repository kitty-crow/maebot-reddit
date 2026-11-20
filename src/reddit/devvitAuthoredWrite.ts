import { parseMap, type Json } from '../types/json.ts';
import { strVal } from '../types/value.ts';
import type { DevvitCommunity } from './devvitPostFeed.ts';

type Base = {
  readonly subreddit: DevvitCommunity;
  readonly operationId: string;
  readonly expectedAuthor: string;
};
export type DevvitAuthoredRequest = Base & (
  | { readonly action: 'self-post'; readonly title: string;
      readonly body: string; readonly flairTemplateId: string | null }
  | { readonly action: 'crosspost'; readonly title: string;
      readonly sourcePostId: string; readonly flairTemplateId: string | null }
  | { readonly action: 'private-message'; readonly recipient: string;
      readonly subject: string; readonly body: string }
  | { readonly action: 'mark-private-message-read'; readonly fullname: string }
);
export type DevvitAuthoredReceipt = {
  readonly protocol: 1;
  readonly operationId: string;
  readonly status: 'applied' | 'already-applied';
  readonly postId?: string;
  readonly postPermalink?: string;
};

const operationPattern=/^[a-z0-9_-]{10,96}$/iu;
const namePattern=/^[a-z0-9_-]{2,32}$/iu;
const templatePattern=/^[0-9a-z_-]{8,96}$/iu;
const postPattern=/^t3_[a-z0-9]+$/iu;
const messagePattern=/^t4_[a-z0-9]+$/iu;
const nonempty = (value:string, label:string, max:number):void => {
  if (typeof value !== 'string' || value.length===0 || value.length>max) {
    throw new Error('Invalid Devvit authored-write '+label);
  }
};
export const validateDevvitAuthoredRequest = (request:DevvitAuthoredRequest):void => {
  if (request.subreddit!=='catgirlcoin' && request.subreddit!=='nyaonearth') {
    throw new Error('Invalid Devvit authored-write community');
  }
  if (!operationPattern.test(request.operationId) || !namePattern.test(request.expectedAuthor)) {
    throw new Error('Invalid canonical author or operation ID');
  }
  if (request.action==='self-post') {
    validatePostRequest(request);
    return;
  }
  if (request.action==='crosspost') {
    validateCrosspostRequest(request);
    return;
  }
  if (request.action==='private-message') {
    validateMessageRequest(request);
    return;
  }
  if (request.action==='mark-private-message-read') {
    validateMarkRequest(request);
    return;
  }
  throw new Error('Unsupported Devvit authored-write operation');
};
const validatePostRequest = (request:Extract<DevvitAuthoredRequest,{readonly action:'self-post'}>):void => {
  nonempty(request.title,'title',300);
  nonempty(request.body,'post body',40_000);
  const id=request.flairTemplateId;
  if (id !== null && (typeof id!=='string' || !templatePattern.test(id))) {
    throw new Error('Invalid Devvit post flair');
  }
};
const validateCrosspostRequest = (
  request:Extract<DevvitAuthoredRequest,{readonly action:'crosspost'}>,
):void => {
  nonempty(request.title,'crosspost title',300);
  if (!postPattern.test(request.sourcePostId)) throw new Error('Invalid crosspost source ID');
  const id=request.flairTemplateId;
  if (id!==null && (typeof id!=='string' || !templatePattern.test(id))) {
    throw new Error('Invalid crosspost flair template ID');
  }
};
const validateMessageRequest = (
  request:Extract<DevvitAuthoredRequest,{readonly action:'private-message'}>,
):void => {
  if (!namePattern.test(request.recipient)) throw new Error('Invalid Devvit message recipient');
  nonempty(request.subject,'subject',100);
  nonempty(request.body,'message body',10_000);
};
const validateMarkRequest = (
  request:Extract<DevvitAuthoredRequest,{readonly action:'mark-private-message-read'}>,
):void => {
  if (!messagePattern.test(request.fullname)) throw new Error('Invalid native private message ID');
};
const nativePostId = (raw:Json|undefined):string => {
  const id=strVal(raw,'native Reddit post ID');
  if (!postPattern.test(id)) throw new Error('Invalid native Reddit post identity');
  return id;
};
const nativePostPermalink = (raw:Json|undefined, postId:string):string => {
  const link=strVal(raw,'native Reddit post permalink');
  if (link.length===0 || link.length>2048
    || !link.includes('/comments/'+postId.slice(3)+'/')) {
    throw new Error('Invalid native Reddit post permalink');
  }
  return link;
};
export const parseDevvitAuthoredReceipt = (
  body:string, request:DevvitAuthoredRequest,
):DevvitAuthoredReceipt => {
  if (body.length>4096) throw new Error('Oversized Devvit authored-write receipt');
  const root=parseMap(body);
  if (root['protocol']!==1 || root['operationId']!==request.operationId) {
    throw new Error('Devvit authored-write receipt does not match canonical operation');
  }
  const status=root['status'];
  if (status!=='applied' && status!=='already-applied') {
    throw new Error('Devvit authored-write operation is not confirmed');
  }
  if (request.action==='self-post' || request.action==='crosspost') {
    return verifyPostReceipt(request.operationId,status,root['postId'],root['postPermalink']);
  }
  if (root['postId']!==undefined || root['postPermalink']!==undefined) {
    throw new Error('Unexpected post metadata in private-message receipt');
  }
  return {protocol:1,operationId:request.operationId,status};
};
const verifyPostReceipt = (
  operationId:string, status:'applied'|'already-applied', raw:Json|undefined,
  rawPermalink:Json|undefined,
):DevvitAuthoredReceipt => {
  if (status!=='applied') throw new Error('Original post identity requires reconciliation');
  const postId=nativePostId(raw);
  const postPermalink=nativePostPermalink(rawPermalink,postId);
  return {protocol:1,operationId,status,postId,postPermalink};
};
