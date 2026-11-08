import { parseMap, type Json } from '../types/json.ts';
import { arrVal, mapVal, numVal, strVal } from '../types/value.ts';
import type { DevvitCommunity } from './devvitPostFeed.ts';

export type DevvitMessageFolder = 'inbox' | 'unread' | 'sent';
export type DevvitMessageRequest = {
  readonly installation: DevvitCommunity;
  readonly folder: DevvitMessageFolder;
  readonly limit: number;
};
export type DevvitMessagePreview = {
  readonly fullname: string;
  readonly fromType: 'user' | 'subreddit';
  readonly fromName: string;
  readonly body: string;
  readonly createdUtc: number;
};

const project = (raw:Json):DevvitMessagePreview => {
  const row=mapVal(raw,'Devvit message preview');
  const fullname=strVal(row['fullname'],'private message.fullname');
  if (!/^t4_[a-z0-9]+$/iu.test(fullname)) throw new Error('Invalid Devvit private message ID');
  const fromType=row['fromType'];
  if (fromType!=='user'&&fromType!=='subreddit') {
    throw new Error('Unknown Devvit private message sender type');
  }
  const fromName=strVal(row['fromName'],'message.fromName');
  if (fromName.trim().length===0) throw new Error('Missing Devvit private message sender');
  const createdUtc=numVal(row['createdUtc'],'message.createdUtc');
  if (!Number.isFinite(createdUtc)||createdUtc<0) throw new Error('Invalid Devvit private message time');
  return {
    fullname,fromType,fromName,body:strVal(row['body'],'message.body'),createdUtc,
  };
};
export const parseDevvitMessages = (
  body:string, request:DevvitMessageRequest,
):readonly DevvitMessagePreview[] => {
  if (body.length>1_048_576) throw new Error('Devvit private message response too large');
  const root=parseMap(body);
  if (root['protocol']!==1||root['installation']!==request.installation
    ||root['folder']!==request.folder||root['accountScope']!=='app') {
    throw new Error('Devvit message preview mismatch or incorrect account scope');
  }
  const rows=arrVal(root['messages'],'Devvit message previews');
  if (rows.length>request.limit) throw new Error('Devvit private message folder exceeded limit');
  const seen=new Set<string>();
  return rows.map((raw):DevvitMessagePreview=>{
    const message=project(raw);
    if (seen.has(message.fullname)) throw new Error('Duplicate Devvit message');
    seen.add(message.fullname);
    return message;
  });
};
