import type { RedditAuthCfg } from '../env.ts';
import {
  devvitRpcClient,
  mediaCall,
  redditCall,
  wireMap,
  wireText,
} from './devvitCompat.ts';
import { DevvitRpcClient } from './devvitRpc.ts';
import { LegacyRedditMediaClient } from './legacyMedia.ts';

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

const uploadType = (mimeType: string): 'image' | 'gif' => {
  const type = mimeType.trim().toLowerCase();
  if (type === 'image/gif') return 'gif';
  if (type.startsWith('image/')) return 'image';
  throw new Error(`Devvit media upload does not support ${mimeType}`);
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
  private readonly legacy: LegacyRedditMediaClient | null;
  private readonly forceLegacy: boolean;

  public constructor(
    cfg: RedditAuthCfg,
    fetcher?: RedditMediaFetch,
    rateReserve = 10,
    socketFactory?: RedditMediaSocketFactory,
  ) {
    this.rpc = devvitRpcClient(cfg);
    this.forceLegacy = cfg.transport === 'legacy';
    const legacy = cfg.legacyOauth ?? null;
    this.legacy = legacy === null
      ? null
      : new LegacyRedditMediaClient(
          {
            clientId: legacy.clientId,
            clientSecret: legacy.clientSecret,
            username: cfg.username,
            password: legacy.password,
            userAgent: legacy.userAgent,
          },
          fetcher,
          rateReserve,
          socketFactory,
        );
  }

  public async uploadMedia(name: string, mimeType: string, bytes: Uint8Array): Promise<string> {
    if (this.legacy !== null) return await this.legacy.uploadMedia(name, mimeType, bytes);
    if (this.forceLegacy) throw new Error('Legacy Reddit media transport is not configured');
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
    if (this.legacy !== null) {
      return await this.legacy.submitMedia(
        subreddit,
        title,
        body,
        flairTemplateId,
        name,
        mimeType,
        bytes,
        videoPosterUrl,
      );
    }
    if (this.forceLegacy) throw new Error('Legacy Reddit media transport is not configured');
    if (body.trim().length > 0 || mimeType === 'video/mp4') {
      throw new Error('This Reddit media submission requires the legacy Reddit OAuth fallback');
    }
    const mediaUrl = await this.uploadMedia(name, mimeType, bytes);
    const kind = 'image';
    return createdPost(await redditCall(this.rpc, 'submitPost', [{
      subredditName: subreddit,
      title,
      kind,
      imageUrls: [mediaUrl],
      sendreplies: true,
      ...(flairTemplateId === null ? {} : { flairId: flairTemplateId }),
    }]));
  }

  public async submitGallery(
    subreddit: string,
    title: string,
    flairTemplateId: string | null,
    media: readonly RedditGalleryMedia[],
  ): Promise<RedditMediaCreatedPost> {
    if (this.legacy !== null) {
      return await this.legacy.submitGallery(subreddit, title, flairTemplateId, media);
    }
    throw new Error('Reddit gallery submission requires the legacy Reddit OAuth fallback');
  }
}
