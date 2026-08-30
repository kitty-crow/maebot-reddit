import type { RedditAuthCfg } from '../env.ts';
import { isMap, parseJson, type Json } from '../types/json.ts';
import { RedditError, statusKind } from './error.ts';
import { rateLimitedRedditFetch } from './rateBudget.ts';

export type RedditMediaFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type RedditMediaCreatedPost = {
  readonly id: string;
  readonly fullname: string;
  readonly url: string;
};

const api = 'https://oauth.reddit.com';
const tokenApi = 'https://www.reddit.com/api/v1/access_token';
const maxBytes = 20 * 1024 * 1024;

type Token = { readonly value: string; readonly until: number };

type Lease = {
  readonly uploadUrl: string;
  readonly fields: ReadonlyMap<string, string>;
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
  if (!isMap(value) || !isMap(value['json']) || !Array.isArray(value['json']['errors'])) return null;
  const first = value['json']['errors'][0];
  if (!Array.isArray(first)) return value['json']['errors'].length === 0 ? null : 'Reddit API returned an application error';
  const parts = first.filter(part => typeof part === 'string').map(part => String(part));
  return parts.length === 0 ? 'Reddit API returned an application error' : parts.join(': ');
};

const createdPost = (value: Json): RedditMediaCreatedPost => {
  if (!isMap(value) || !isMap(value['json']) || !isMap(value['json']['data'])) {
    throw new RedditError('Reddit media submit response was incomplete', 'invalid_response');
  }
  const data = value['json']['data'];
  const id = text(data['id']);
  if (id === null) throw new RedditError('Reddit media submit response did not contain a post id', 'invalid_response');
  return {
    id,
    fullname: text(data['name']) ?? `t3_${id}`,
    url: text(data['url']) ?? '',
  };
};

const leaseFrom = (value: Json): Lease => {
  if (!isMap(value) || !isMap(value['args']) || !Array.isArray(value['args']['fields'])) {
    throw new RedditError('Reddit media lease response was incomplete', 'invalid_response');
  }
  const action = text(value['args']['action']);
  if (action === null) throw new RedditError('Reddit media lease did not include an upload target', 'invalid_response');
  const fields = new Map<string, string>();
  for (const raw of value['args']['fields']) {
    if (!isMap(raw)) continue;
    const name = text(raw['name']);
    const fieldValue = text(raw['value']);
    if (name !== null && fieldValue !== null) fields.set(name, fieldValue);
  }
  if (!fields.has('key')) throw new RedditError('Reddit media lease did not include an object key', 'invalid_response');
  const uploadUrl = action.startsWith('//') ? `https:${action}` : action;
  const parsed = new URL(uploadUrl);
  if (parsed.protocol !== 'https:') throw new RedditError('Reddit media upload target was not HTTPS', 'invalid_response');
  return { uploadUrl: parsed.toString().replace(/\/$/u, ''), fields };
};

export class RedditMediaClient {
  private tokenCache: Token | null = null;
  private readonly fetcher: RedditMediaFetch;

  public constructor(
    private readonly cfg: RedditAuthCfg,
    fetcher?: RedditMediaFetch,
    rateReserve = 10,
  ) {
    const rawFetcher = fetcher ?? fetch;
    this.fetcher = fetcher === undefined
      ? rateLimitedRedditFetch(rawFetcher, cfg.clientId, { reserve: rateReserve })
      : rawFetcher;
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

  public async uploadMedia(name: string, mimeType: string, bytes: Uint8Array): Promise<string> {
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
    return `${lease.uploadUrl}/${key.replace(/^\//u, '')}`;
  }

  public async submitMedia(
    subreddit: string,
    title: string,
    body: string,
    flairTemplateId: string | null,
    name: string,
    mimeType: string,
    bytes: Uint8Array,
  ): Promise<RedditMediaCreatedPost> {
    const kind = mimeType.startsWith('image/') ? 'image' : mimeType === 'video/mp4' ? 'video' : null;
    if (kind === null) throw new Error(`Unsupported Reddit post media type ${mimeType}`);
    const mediaUrl = await this.uploadMedia(name, mimeType, bytes);
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
    return createdPost(payload);
  }
}
