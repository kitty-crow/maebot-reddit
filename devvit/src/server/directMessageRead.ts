import type { Community } from './postFeed.ts';

type Json = null | boolean | string | number | Json[] | { readonly [key:string]: Json };
export type MessageFolder = 'inbox' | 'unread' | 'sent';
export type MessageReadRequest = {
  readonly installation: Community; readonly folder: MessageFolder; readonly limit: number;
};
export type MessageSource = {
  readonly id: string;
  readonly from:
    | { readonly type: 'user'; readonly username: string }
    | { readonly type: 'subreddit'; readonly name: string };
  readonly body: string;
  readonly created: Date;
};
export type MessagePreview = {
  readonly fullname: string;
  readonly fromType: 'user' | 'subreddit';
  readonly fromName: string;
  readonly body: string;
  readonly createdUtc: number;
};

export const parseMessageReadRequest = (raw: Json): MessageReadRequest => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid private message preview request');
  }
  const installation = raw['installation'];
  if (installation !== 'catgirlcoin' && installation !== 'nyaonearth') {
    throw new Error('Unrecognised private message installation');
  }
  const folder = raw['folder'];
  if (folder !== 'inbox' && folder !== 'unread' && folder !== 'sent') {
    throw new Error('Unrecognised private message folder');
  }
  const limit = raw['limit'];
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Invalid private message preview limit');
  }
  if (Object.keys(raw).some(key => key !== 'installation' && key !== 'folder' && key !== 'limit')) {
    throw new Error('Unexpected private message preview field');
  }
  return { installation, folder, limit };
};
export const projectMessagePreview = (source: MessageSource): MessagePreview => {
  if (!/^t4_[a-z0-9]+$/iu.test(source.id)) throw new Error('Invalid private message fullname');
  const fromName = source.from.type === 'user' ? source.from.username : source.from.name;
  if (fromName.trim().length === 0) throw new Error('Private message author missing');
  const createdUtc = source.created.getTime() / 1000;
  if (!Number.isFinite(createdUtc)) throw new Error('Invalid private message timestamp');
  return {
    fullname:source.id,fromType:source.from.type,fromName,body:source.body,createdUtc,
  };
};
export const projectMessageFolder = (
  source:readonly MessageSource[], limit:number,
):readonly MessagePreview[] => {
  if (source.length > limit) throw new Error('Devvit private message listing exceeded limit');
  const seen = new Set<string>();
  return source.map(message => {
    const preview = projectMessagePreview(message);
    if (seen.has(preview.fullname)) throw new Error('Duplicate private message in folder');
    seen.add(preview.fullname);
    return preview;
  });
};
