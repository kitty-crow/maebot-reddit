// Preserve Mae Reddit's original post model at the external transport boundary.
export type PostFeed = 'new' | 'hot';
export type Community = 'catgirlcoin' | 'nyaonearth';
export type FeedRequest = {
  readonly subreddit: Community;
  readonly feed: PostFeed;
  readonly limit: number;
};
export type PostSource = {
  readonly id: string;
  readonly subredditName: string;
  readonly title: string;
  readonly authorName: string;
  readonly permalink: string;
  readonly createdAt: Date;
  readonly body: string | undefined;
  readonly url: string;
  readonly flair: { readonly templateId?: string; readonly text?: string } | undefined;
  readonly stickied: boolean;
  readonly locked: boolean;
  readonly nsfw: boolean;
  readonly crosspostParentId: string | undefined;
  readonly score: number;
  readonly gallery: readonly { readonly url: string }[];
  readonly thumbnail: { readonly url: string } | undefined;
  readonly secureMedia: object | undefined;
};
export type FeedPost = {
  readonly id: string;
  readonly fullname: string;
  readonly subreddit: string;
  readonly title: string;
  readonly author: string | null;
  readonly permalink: string;
  readonly createdUtc: number;
  readonly selfText: string;
  readonly url: string;
  readonly flairTemplateId: string | null;
  readonly flairText: string | null;
  readonly stickied: boolean;
  readonly locked: boolean;
  readonly over18: boolean;
  readonly crosspostParent: string | null;
  readonly score: number;
  readonly mediaUrls: readonly string[];
};

type Json = null | string | number | boolean | Json[] | { readonly [key: string]: Json };
const directMedia = /(?:i\.redd\.it|preview\.redd\.it|external-preview\.redd\.it|\.gif(?:v)?(?:$|[?#])|\.(?:avif|jpe?g|png|webp)(?:$|[?#]))/iu;
const mediaUrl = (value: string): string | null => {
  const clean = value.replaceAll('&amp;', '&').trim();
  return /^https?:\/\//iu.test(clean) ? clean : null;
};
const addMedia = (value: string, output: Set<string>): void => {
  const url = mediaUrl(value);
  if (url !== null) output.add(url);
};
const collectMedia = (value: Json, output: Set<string>): void => {
  if (typeof value === 'string') {
    addMedia(value, output);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMedia(item, output);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const item of Object.values(value)) collectMedia(item, output);
};
const postMedia = (post: PostSource): readonly string[] => {
  const urls = new Set<string>();
  const direct = mediaUrl(post.url);
  if (direct !== null && directMedia.test(direct)) urls.add(direct);
  for (const item of post.gallery) {
    const url = mediaUrl(item.url);
    if (url !== null) urls.add(url);
  }
  const thumbnail = post.thumbnail?.url;
  if (thumbnail !== undefined) addMedia(thumbnail, urls);
  if (post.secureMedia !== undefined) {
    collectMedia(JSON.parse(JSON.stringify(post.secureMedia)) as Json, urls);
  }
  return [...urls].slice(0, 12);
};
export const projectPost = (post: PostSource): FeedPost => {
  if (!/^t3_[a-z0-9]+$/iu.test(post.id)) throw new Error('Invalid Devvit post id');
  if (!Number.isFinite(post.createdAt.getTime()) || !Number.isFinite(post.score)) {
    throw new Error('Invalid Devvit post metadata');
  }
  return {
    id: post.id.slice(3),
    fullname: post.id,
    subreddit: post.subredditName,
    title: post.title,
    author: post.authorName === '[deleted]' ? null : post.authorName,
    permalink: post.permalink,
    createdUtc: post.createdAt.getTime() / 1000,
    selfText: post.body ?? '',
    url: post.url,
    flairTemplateId: post.flair?.templateId ?? null,
    flairText: post.flair?.text ?? null,
    stickied: post.stickied,
    locked: post.locked,
    over18: post.nsfw,
    crosspostParent: post.crosspostParentId ?? null,
    score: Math.floor(post.score),
    mediaUrls: postMedia(post),
  };
};
export const parseFeedRequest = (raw: Json): FeedRequest => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Expected an object');
  const subreddit = raw['subreddit'];
  const feed = raw['feed'];
  const limit = raw['limit'];
  if (subreddit !== 'catgirlcoin' && subreddit !== 'nyaonearth') throw new Error('Unknown community');
  if (feed !== 'new' && feed !== 'hot') throw new Error('Unknown post feed');
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Invalid feed limit');
  }
  return { subreddit, feed, limit };
};
