import { isMap, parseJson, type Json } from '../types/json.ts';
import { RedditError, statusKind } from './error.ts';
import { rateLimitedRedditFetch } from './rateBudget.ts';

export type LegacyRedditMediaFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type LegacyRedditMediaSocket = {
  listen(
    onMessage: (data: string) => void,
    onError: () => void,
    onClose: () => void,
  ): void;
  close(): void;
};

export type LegacyRedditMediaSocketFactory = (url: string) => LegacyRedditMediaSocket;

export type LegacyRedditMediaCreatedPost = {
  readonly id: string;
  readonly fullname: string;
  readonly url: string;
};

export type LegacyRedditGalleryMedia = {
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
};

const api = 'https://oauth.reddit.com';
const tokenApi = 'https://www.reddit.com/api/v1/access_token';
const maxBytes = 20 * 1024 * 1024;
const mediaSocketTimeoutMs = 60_000;

type Token = { readonly value: string; readonly until: number };

type Lease = {
  readonly uploadUrl: string;
  readonly fields: ReadonlyMap<string, string>;
  readonly mediaId: string | null;
};

type Uploaded = {
  readonly url: string;
  readonly mediaId: string | null;
};

const jsonPayload = (raw: string, context: string): Json => {
  try {
    return parseJson(raw);
  } catch {
    throw new RedditError(`${context} returned invalid JSON`, 'invalid_response');
  }
};

const text = (value: Json | undefined): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const firstApiError = (value: Json): string | null => {
  if (!isMap(value)) return null;
  const envelope = value['json'];
  if (!isMap(envelope)) return null;
  const errors = envelope['errors'];
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const first = errors[0];
  if (!Array.isArray(first)) return 'Reddit API returned an application error';
  const parts = first.filter(part => typeof part === 'string').map(part => String(part));
  return parts.length === 0 ? 'Reddit API returned an application error' : parts.join(': ');
};

const submitData = (value: Json): Readonly<Record<string, Json>> => {
  if (!isMap(value)) throw new RedditError('Reddit media submit response was not an object', 'invalid_response');
  const envelope = value['json'];
  if (!isMap(envelope)) throw new RedditError('Reddit media submit response did not contain json', 'invalid_response');
  const data = envelope['data'];
  if (!isMap(data)) throw new RedditError('Reddit media submit response did not contain data', 'invalid_response');
  return data;
};

const createdPost = (value: Json): LegacyRedditMediaCreatedPost => {
  const data = submitData(value);
  const id = text(data['id']);
  if (id === null) throw new RedditError('Reddit media submit response did not contain a post id', 'invalid_response');
  return {
    id,
    fullname: text(data['name']) ?? `t3_${id}`,
    url: text(data['url']) ?? '',
  };
};

const immediateCreatedPost = (value: Json): LegacyRedditMediaCreatedPost | null => {
  const data = submitData(value);
  const id = text(data['id']);
  if (id === null) return null;
  return {
    id,
    fullname: text(data['name']) ?? `t3_${id}`,
    url: text(data['url']) ?? '',
  };
};

const mediaSocketUrl = (value: Json): string | null => {
  const raw = text(submitData(value)['websocket_url']);
  if (raw === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new RedditError('Reddit media submit websocket URL was invalid', 'invalid_response');
  }
  if (
    parsed.protocol !== 'wss:'
    || (parsed.hostname !== 'wss.redditmedia.com' && !parsed.hostname.endsWith('.wss.redditmedia.com'))
  ) {
    throw new RedditError('Reddit media submit websocket URL was not trusted', 'invalid_response');
  }
  return parsed.toString();
};

const postFromRedirect = (raw: string): LegacyRedditMediaCreatedPost => {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new RedditError('Reddit media websocket redirect was invalid', 'invalid_response');
  }
  if (parsed.protocol !== 'https:' || (parsed.hostname !== 'reddit.com' && !parsed.hostname.endsWith('.reddit.com'))) {
    throw new RedditError('Reddit media websocket redirect was not a Reddit URL', 'invalid_response');
  }
  const match = /^\/r\/[^/]+\/comments\/([a-z0-9]+)(?:\/|$)/iu.exec(parsed.pathname)
    ?? /^\/comments\/([a-z0-9]+)(?:\/|$)/iu.exec(parsed.pathname);
  const id = match?.[1] ?? null;
  if (id === null) throw new RedditError('Reddit media websocket redirect did not contain a post id', 'invalid_response');
  return { id, fullname: `t3_${id}`, url: parsed.toString() };
};

const defaultSocketFactory: LegacyRedditMediaSocketFactory = url => {
  const socket = new WebSocket(url);
  return {
    listen(onMessage, onError, onClose): void {
      socket.addEventListener('message', event => {
        if (typeof event.data === 'string') onMessage(event.data);
        else onError();
      });
      socket.addEventListener('error', onError);
      socket.addEventListener('close', onClose);
    },
    close(): void {
      socket.close();
    },
  };
};

const awaitMediaPost = async (
  url: string,
  socketFactory: LegacyRedditMediaSocketFactory,
): Promise<LegacyRedditMediaCreatedPost> => await new Promise((resolve, reject) => {
  let settled = false;
  let socket: LegacyRedditMediaSocket;
  const finish = (post: LegacyRedditMediaCreatedPost | null, error: RedditError | null): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    socket.close();
    if (post !== null) resolve(post);
    else reject(error ?? new RedditError('Reddit media websocket failed', 'network'));
  };
  const timeout = setTimeout(() => {
    finish(null, new RedditError('Reddit media websocket timed out', 'network'));
  }, mediaSocketTimeoutMs);
  try {
    socket = socketFactory(url);
    socket.listen(
      data => {
        let payload: Json;
        try {
          payload = jsonPayload(data, 'Reddit media websocket');
        } catch (error) {
          finish(null, error instanceof RedditError
            ? error
            : new RedditError('Reddit media websocket returned invalid JSON', 'invalid_response'));
          return;
        }
        if (!isMap(payload)) {
          finish(null, new RedditError('Reddit media websocket response was not an object', 'invalid_response'));
          return;
        }
        const type = text(payload['type']);
        if (type === 'success') {
          const body = payload['payload'];
          const redirect = isMap(body) ? text(body['redirect']) : null;
          if (redirect === null) {
            finish(null, new RedditError('Reddit media websocket success did not contain a redirect', 'invalid_response'));
            return;
          }
          try {
            finish(postFromRedirect(redirect), null);
          } catch (error) {
            finish(null, error instanceof RedditError
              ? error
              : new RedditError('Reddit media websocket redirect was invalid', 'invalid_response'));
          }
          return;
        }
        if (type === 'error' || type === 'failure') {
          finish(null, new RedditError('Reddit media processing failed', 'invalid_response'));
        }
      },
      () => finish(null, new RedditError('Reddit media websocket failed at the network boundary', 'network')),
      () => finish(null, new RedditError('Reddit media websocket closed before completion', 'network')),
    );
  } catch {
    clearTimeout(timeout);
    settled = true;
    reject(new RedditError('Reddit media websocket failed at the network boundary', 'network'));
  }
});

const leaseFrom = (value: Json): Lease => {
  if (!isMap(value)) throw new RedditError('Reddit media lease response was not an object', 'invalid_response');
  const args = value['args'];
  if (!isMap(args) || !Array.isArray(args['fields'])) {
    throw new RedditError('Reddit media lease response was incomplete', 'invalid_response');
  }
  const action = text(args['action']);
  if (action === null) throw new RedditError('Reddit media lease did not include an upload target', 'invalid_response');
  const fields = new Map<string, string>();
  for (const raw of args['fields']) {
    if (!isMap(raw)) continue;
    const name = text(raw['name']);
    const fieldValue = text(raw['value']);
    if (name !== null && fieldValue !== null) fields.set(name, fieldValue);
  }
  if (!fields.has('key')) throw new RedditError('Reddit media lease did not include an object key', 'invalid_response');
  const uploadUrl = action.startsWith('//') ? `https:${action}` : action;
  const parsed = new URL(uploadUrl);
  if (parsed.protocol !== 'https:') throw new RedditError('Reddit media upload target was not HTTPS', 'invalid_response');
  const rawAsset = value['asset'];
  const asset = isMap(rawAsset) ? rawAsset : null;
  return {
    uploadUrl: parsed.toString().replace(/\/$/u, ''),
    fields,
    mediaId: asset === null ? null : text(asset['asset_id']),
  };
};

export type LegacyRedditMediaAuth = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly username: string;
  readonly password: string;
  readonly userAgent: string;
};

export class LegacyRedditMediaClient {
  private tokenCache: Token | null = null;
  private readonly fetcher: LegacyRedditMediaFetch;
  private readonly socketFactory: LegacyRedditMediaSocketFactory;

  public constructor(
    private readonly cfg: LegacyRedditMediaAuth,
    fetcher?: LegacyRedditMediaFetch,
    rateReserve = 10,
    socketFactory: LegacyRedditMediaSocketFactory = defaultSocketFactory,
  ) {
    const rawFetcher = fetcher ?? fetch;
    this.fetcher = fetcher === undefined
      ? rateLimitedRedditFetch(rawFetcher, cfg.clientId, { reserve: rateReserve })
      : rawFetcher;
    this.socketFactory = socketFactory;
  }

  private async token(force = false): Promise<string> {
    const now = Date.now();
    if (!force && this.tokenCache !== null && this.tokenCache.until > now + 60_000) return this.tokenCache.value;
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64');
    let response: Response;
    try {
      response = await this.fetcher(tokenApi, {
        method: 'POST',
        headers: {
          authorization: `Basic ${basic}`,
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': this.cfg.userAgent,
        },
        body: new URLSearchParams({
          grant_type: 'password',
          username: this.cfg.username,
          password: this.cfg.password,
        }),
      });
    } catch {
      throw new RedditError('OAuth token request failed at the network boundary', 'network');
    }
    if (!response.ok) throw new RedditError('OAuth token request was rejected', statusKind(response.status), response.status);
    const payload = jsonPayload(await response.text(), 'OAuth token request');
    if (!isMap(payload)) throw new RedditError('OAuth token response was not an object', 'invalid_response', response.status);
    const value = text(payload['access_token']);
    const seconds = payload['expires_in'];
    if (value === null || typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
      throw new RedditError('OAuth token response was incomplete', 'invalid_response', response.status);
    }
    this.tokenCache = { value, until: now + Math.floor(seconds * 1_000) };
    return value;
  }

  private async lease(name: string, mimeType: string, reauthed = false): Promise<Lease> {
    const token = await this.token(reauthed);
    let response: Response;
    try {
      response = await this.fetcher(`${api}/api/media/asset.json?raw_json=1`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': this.cfg.userAgent,
        },
        body: new URLSearchParams({ filepath: name, mimetype: mimeType }),
      });
    } catch {
      throw new RedditError('Reddit media lease failed at the network boundary', 'network');
    }
    if (response.status === 401 && !reauthed) {
      this.tokenCache = null;
      return await this.lease(name, mimeType, true);
    }
    if (!response.ok) throw new RedditError('Reddit media lease was rejected', statusKind(response.status), response.status);
    return leaseFrom(jsonPayload(await response.text(), 'Reddit media lease'));
  }

  private async upload(name: string, mimeType: string, bytes: Uint8Array): Promise<Uploaded> {
    if (bytes.byteLength < 1 || bytes.byteLength > maxBytes) throw new Error('Reddit media must be between 1 byte and 20 MB');
    const lease = await this.lease(name, mimeType);
    const form = new FormData();
    for (const [field, value] of lease.fields) form.append(field, value);
    const owned = Uint8Array.from(bytes);
    form.append('file', new Blob([owned.buffer], { type: mimeType }), name);

    let response: Response;
    try {
      response = await this.fetcher(lease.uploadUrl, { method: 'POST', body: form });
    } catch {
      throw new RedditError('Reddit media upload failed at the network boundary', 'network');
    }
    if (!response.ok) throw new RedditError('Reddit media upload was rejected', statusKind(response.status), response.status);
    const key = lease.fields.get('key');
    if (key === undefined || key.length === 0) throw new RedditError('Reddit media upload key was missing', 'invalid_response');
    return {
      url: `${lease.uploadUrl}/${key.replace(/^\//u, '')}`,
      mediaId: lease.mediaId,
    };
  }

  public async uploadMedia(name: string, mimeType: string, bytes: Uint8Array): Promise<string> {
    return (await this.upload(name, mimeType, bytes)).url;
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
  ): Promise<LegacyRedditMediaCreatedPost> {
    const kind = mimeType.startsWith('image/') ? 'image' : mimeType === 'video/mp4' ? 'video' : null;
    if (kind === null) throw new Error(`Unsupported Reddit post media type ${mimeType}`);
    if (kind === 'video' && (videoPosterUrl === null || videoPosterUrl.length === 0)) {
      throw new Error('Reddit native video submission requires a poster URL');
    }
    const mediaUrl = (await this.upload(name, mimeType, bytes)).url;
    const token = await this.token();
    const form = new URLSearchParams({
      api_type: 'json',
      kind,
      resubmit: 'true',
      sendreplies: 'true',
      sr: subreddit,
      text: body,
      title,
      url: mediaUrl,
    });
    if (kind === 'video' && videoPosterUrl !== null) form.set('video_poster_url', videoPosterUrl);
    if (flairTemplateId !== null && flairTemplateId.length > 0) form.set('flair_id', flairTemplateId);

    let response: Response;
    try {
      response = await this.fetcher(`${api}/api/submit`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': this.cfg.userAgent,
        },
        body: form,
      });
    } catch {
      throw new RedditError('Reddit native media submission failed at the network boundary', 'network');
    }
    if (!response.ok) {
      throw new RedditError('Reddit native media submission was rejected', statusKind(response.status), response.status);
    }
    const payload = jsonPayload(await response.text(), 'Reddit native media submission');
    const apiError = firstApiError(payload);
    if (apiError !== null) throw new RedditError(apiError, 'invalid_response', response.status);
    const immediate = immediateCreatedPost(payload);
    if (immediate !== null) return immediate;
    const socketUrl = mediaSocketUrl(payload);
    if (socketUrl === null) throw new RedditError('Reddit media submit response did not contain a post id or websocket URL', 'invalid_response');
    return await awaitMediaPost(socketUrl, this.socketFactory);
  }

  public async submitGallery(
    subreddit: string,
    title: string,
    flairTemplateId: string | null,
    media: readonly LegacyRedditGalleryMedia[],
  ): Promise<LegacyRedditMediaCreatedPost> {
    if (media.length < 2 || media.length > 20) throw new Error('Reddit galleries require between 2 and 20 images');
    const items: { readonly media_id: string }[] = [];
    for (const item of media) {
      if (!item.mimeType.startsWith('image/')) throw new Error(`Unsupported Reddit gallery media type ${item.mimeType}`);
      const uploaded = await this.upload(item.name, item.mimeType, item.bytes);
      if (uploaded.mediaId === null) throw new RedditError('Reddit gallery media lease did not include an asset id', 'invalid_response');
      items.push({ media_id: uploaded.mediaId });
    }

    const token = await this.token();
    const payload: Record<string, string | boolean | readonly { readonly media_id: string }[]> = {
      api_type: 'json',
      items,
      nsfw: false,
      sendreplies: true,
      spoiler: false,
      sr: subreddit,
      title,
    };
    if (flairTemplateId !== null && flairTemplateId.length > 0) payload['flair_id'] = flairTemplateId;

    let response: Response;
    try {
      response = await this.fetcher(`${api}/api/submit_gallery_post.json`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'user-agent': this.cfg.userAgent,
        },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new RedditError('Reddit gallery submission failed at the network boundary', 'network');
    }
    if (!response.ok) throw new RedditError('Reddit gallery submission was rejected', statusKind(response.status), response.status);
    const result = jsonPayload(await response.text(), 'Reddit gallery submission');
    const apiError = firstApiError(result);
    if (apiError !== null) throw new RedditError(apiError, 'invalid_response', response.status);
    return createdPost(result);
  }
}