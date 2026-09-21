import type { RedditAuthCfg, RedditLegacyOauthCfg } from '../env.ts';
import { isMap, parseJson, type Json } from '../types/json.ts';
import { RedditError, statusKind } from './error.ts';
import { retryAfterMs } from './rate.ts';
import { rateLimitedRedditFetch } from './rateBudget.ts';

export type LegacyRedditFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type Token = {
  readonly value: string;
  readonly until: number;
};

const api = 'https://oauth.reddit.com';
const tokenApi = 'https://www.reddit.com/api/v1/access_token';

const jsonPayload = (raw: string, context: string): Json => {
  if (raw.trim().length === 0) return null;
  try {
    return parseJson(raw);
  } catch {
    throw new RedditError(`${context} returned invalid JSON`, 'invalid_response');
  }
};

export class LegacyRedditApi {
  private readonly fetcher: LegacyRedditFetch;
  private tokenCache: Token | null = null;

  public constructor(
    private readonly username: string,
    private readonly cfg: RedditLegacyOauthCfg,
    fetcher: LegacyRedditFetch = fetch,
  ) {
    this.fetcher = rateLimitedRedditFetch(fetcher, cfg.clientId);
  }

  public async get(path: string): Promise<Json> {
    return await this.request('GET', path);
  }

  public async form(path: string, body: URLSearchParams): Promise<Json> {
    return await this.request('POST', path, body);
  }

  public async upload(url: string, body: FormData): Promise<Response> {
    try {
      return await this.fetcher(url, { method: 'POST', body });
    } catch {
      throw new RedditError('Reddit fallback upload failed at the network boundary', 'network');
    }
  }

  private async token(force = false): Promise<string> {
    const now = Date.now();
    if (!force && this.tokenCache !== null && this.tokenCache.until > now + 60_000) {
      return this.tokenCache.value;
    }

    let response: Response;
    try {
      response = await this.fetcher(tokenApi, {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': this.cfg.userAgent,
        },
        body: new URLSearchParams({
          grant_type: 'password',
          username: this.username,
          password: this.cfg.password,
        }),
      });
    } catch {
      throw new RedditError('Reddit fallback OAuth token request failed at the network boundary', 'network');
    }

    if (!response.ok) {
      throw new RedditError(
        'Reddit fallback OAuth token request was rejected',
        statusKind(response.status),
        response.status,
        retryAfterMs(response.headers),
      );
    }

    const payload = jsonPayload(await response.text(), 'Reddit fallback OAuth token request');
    if (!isMap(payload)) {
      throw new RedditError('Reddit fallback OAuth token response was not an object', 'invalid_response');
    }
    const value = payload['access_token'];
    const seconds = payload['expires_in'];
    if (
      typeof value !== 'string'
      || value.length === 0
      || typeof seconds !== 'number'
      || !Number.isFinite(seconds)
      || seconds <= 0
    ) {
      throw new RedditError('Reddit fallback OAuth token response was incomplete', 'invalid_response');
    }

    this.tokenCache = {
      value,
      until: now + Math.floor(seconds * 1_000),
    };
    return value;
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: URLSearchParams,
    reauthed = false,
  ): Promise<Json> {
    const url = new URL(`${api}${path}`);
    if (!url.searchParams.has('raw_json')) url.searchParams.set('raw_json', '1');

    let response: Response;
    try {
      response = await this.fetcher(url, {
        method,
        headers: {
          authorization: `Bearer ${await this.token(reauthed)}`,
          ...(body === undefined ? {} : { 'content-type': 'application/x-www-form-urlencoded' }),
          'user-agent': this.cfg.userAgent,
        },
        ...(body === undefined ? {} : { body }),
      });
    } catch (error) {
      if (error instanceof RedditError) throw error;
      throw new RedditError('Reddit fallback request failed at the network boundary', 'network');
    }

    if (response.status === 401 && !reauthed) {
      this.tokenCache = null;
      return await this.request(method, path, body, true);
    }

    if (!response.ok) {
      throw new RedditError(
        `${method} ${url.pathname} failed`,
        statusKind(response.status),
        response.status,
        retryAfterMs(response.headers),
      );
    }

    return jsonPayload(await response.text(), `${method} ${url.pathname}`);
  }
}

export const legacyRedditApi = (
  cfg: RedditAuthCfg,
  fetcher?: LegacyRedditFetch,
): LegacyRedditApi | null => {
  const legacy = cfg.legacyOauth ?? null;
  return legacy === null ? null : new LegacyRedditApi(cfg.username, legacy, fetcher);
};
