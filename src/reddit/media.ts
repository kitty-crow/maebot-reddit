import type { RedditAuthCfg } from '../env.ts';
import {
  devvitRpcClient,
  mediaCall,
  redditCall,
  wireMap,
  wireText,
} from './devvitCompat.ts';
import { DevvitRpcClient } from './devvitRpc.ts';

export type RedditMediaFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type RedditMediaSocket = {
  listen(
    onMessage: (data: string) => void,
    onError: () => void,
    onClose: () => void,
  ): void;
  close(): void;
};

export type RedditMediaSocketFactory = (url: string) => RedditMediaSocket;

export type RedditMediaCreatedPost = {
  readonly id: string;
  readonly fullname: string;
  readonly url: string;
};

export type RedditGalleryMedia = {
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
};

const maxBytes = 20 * 1024 * 1024;

const dataUrl = (mimeType: string, bytes: Uint8Array): string => {
  if (bytes.byteLength < 1 || bytes.byteLength > maxBytes) {
    throw new Error('Reddit media must be between 1 byte and 20 MB');
  }
  return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
};

const uploadType = (mimeType: string): 'image' | 'gif' | 'video' => {
  const type = mimeType.trim().toLowerCase();
  if (type === 'image/gif') return 'gif';
  if (type.startsWith('image/')) return 'image';
  if (type === 'video/mp4') return 'video';
  throw new Error(`Unsupported Reddit media type ${mimeType}`);
};

const createdPost = (value: Awaited<ReturnType<typeof redditCall>>): RedditMediaCreatedPost => {
  const raw = wireMap(value, 'Devvit created media post');
  const rawId = wireText(raw['id'], 'Devvit created media post id');
  const id = rawId.startsWith('t3_') ? rawId.slice(3) : rawId;
  return {
    id,
    fullname: rawId.startsWith('t3_') ? rawId : `t3_${rawId}`,
    url: wireText(raw['url'], 'Devvit created media post url', ''),
  };
};

export class RedditMediaClient {
  private readonly rpc: DevvitRpcClient;

  public constructor(
    cfg: RedditAuthCfg,
    _fetcher?: RedditMediaFetch,
    _rateReserve = 10,
    _socketFactory?: RedditMediaSocketFactory,
  ) {
    this.rpc = devvitRpcClient(cfg);
  }

  public async uploadMedia(_name: string, mimeType: string, bytes: Uint8Array): Promise<string> {
    const value = await mediaCall(this.rpc, 'upload', [{
      url: dataUrl(mimeType, bytes),
      type: uploadType(mimeType),
    }]);
    const raw = wireMap(value, 'Devvit media upload');
    return wireText(raw['mediaUrl'], 'Devvit media upload URL');
  }

  public async submitMedia(
    subreddit: string,
    title: string,
    body: string,
    flairTemplateId: string | null,
    name: string,
    mimeType: string,
    bytes: Uint8Array,
    videoPosterUrl: string | null = null,
  ): Promise<RedditMediaCreatedPost> {
    const mediaUrl = await this.uploadMedia(name, mimeType, bytes);
    const kind = mimeType === 'video/mp4' ? 'video' : 'image';
    return createdPost(await redditCall(this.rpc, 'submitPost', [{
      subredditName: subreddit,
      title,
      kind,
      imageUrls: [mediaUrl],
      text: body,
      sendreplies: true,
      ...(videoPosterUrl === null ? {} : { videoPosterUrl }),
      ...(flairTemplateId === null ? {} : { flairId: flairTemplateId }),
    }]));
  }

  public async submitGallery(
    subreddit: string,
    title: string,
    flairTemplateId: string | null,
    media: readonly RedditGalleryMedia[],
  ): Promise<RedditMediaCreatedPost> {
    if (media.length < 2 || media.length > 20) {
      throw new Error('Reddit galleries require between 2 and 20 images');
    }
    const imageUrls: string[] = [];
    for (const item of media) {
      if (!item.mimeType.startsWith('image/')) {
        throw new Error(`Unsupported Reddit gallery media type ${item.mimeType}`);
      }
      imageUrls.push(await this.uploadMedia(item.name, item.mimeType, item.bytes));
    }
    return createdPost(await redditCall(this.rpc, 'submitPost', [{
      subredditName: subreddit,
      title,
      kind: 'image',
      imageUrls,
      sendreplies: true,
      ...(flairTemplateId === null ? {} : { flairId: flairTemplateId }),
    }]));
  }
}
