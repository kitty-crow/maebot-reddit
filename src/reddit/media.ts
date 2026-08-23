import type { RedditAuthCfg } from '../env.ts';
import { isMap, parseJson, type Json } from '../types/json.ts';
import { RedditError, statusKind } from './error.ts';

export type RedditMediaFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

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

  public constructor(
    private readonly cfg: RedditAuthCfg,
    private readonly fetcher: RedditMediaFetch = fetch,
  ) {}

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
}
