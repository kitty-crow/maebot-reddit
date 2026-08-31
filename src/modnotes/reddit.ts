import type { RedditAuthCfg } from '../env.ts';
import * as decode from '../reddit/decode.ts';
import { RedditError, statusKind } from '../reddit/error.ts';
import { backoffMs, retryAfterMs } from '../reddit/rate.ts';
import { rateLimitedRedditFetch } from '../reddit/rateBudget.ts';
import type { RedditComment } from '../reddit/types.ts';
import type { Json } from '../types/json.ts';
import { isMap, parseJson } from '../types/json.ts';
import { numVal, strVal } from '../types/value.ts';
import type { MemberModNoteLabel } from './store.ts';

export type MemberModNotesFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type MemberModNotesRedditOptions = {
  readonly fetcher?: MemberModNotesFetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly random?: () => number;
  readonly maxAttempts?: number;
  readonly rateReserve?: number;
};

type Token = {
  readonly value: string;
  readonly until: number;
};

const api = 'https://oauth.reddit.com';
const tokenApi = 'https://www.reddit.com/api/v1/access_token';
const defaultSleep = async (milliseconds: number): Promise<void> => {
  await new Promise<void>(resolve => setTimeout(resolve, milliseconds));
};

const json = async (response: Response, context: string): Promise<Json> => {
  const raw = await response.text();
  if (raw.trim().length === 0) return null;
  try {
    return parseJson(raw);
  } catch {
    throw new RedditError(`${context} returned invalid JSON`, 'invalid_response', response.status);
  }
};

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

const username = (raw: string): string => {
  const value = raw.trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/u.test(value)) throw new Error(`Invalid Reddit username ${raw}`);
  return value;
};

const subreddit = (raw: string): string => {
  const value = raw.trim().replace(/^r\//iu, '');
  if (!/^[A-Za-z0-9_]{2,21}$/u.test(value)) throw new Error(`Invalid subreddit ${raw}`);
  return value;
};

export class MemberModNotesRedditClient {
  private readonly fetcher: MemberModNotesFetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly maxAttempts: number;
  private tokenCache: Token | null = null;

  public constructor(
    private readonly cfg: RedditAuthCfg,
    options: MemberModNotesRedditOptions = {},
  ) {
    this.sleep = options.sleep ?? defaultSleep;
    const rawFetcher = options.fetcher ?? fetch;
    this.fetcher = options.fetcher === undefined
      ? rateLimitedRedditFetch(rawFetcher, cfg.clientId, {
          reserve: options.rateReserve,
          sleep: this.sleep,
        })
      : rawFetcher;
    this.random = options.random ?? Math.random;
    this.maxAttempts = Math.max(1, Math.min(8, Math.floor(options.maxAttempts ?? 4)));
  }

  public async recentCommentsInCommunities(
    rawUsername: string,
    communities: readonly string[],
    limit = 10,
    maxScanned = 1_000,
  ): Promise<readonly RedditComment[]> {
    const user = username(rawUsername);
    const wanted = new Set(communities.map(value => subreddit(value).toLowerCase()));
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const safeMax = Math.max(safeLimit, Math.min(1_000, Math.floor(maxScanned)));
    const out: RedditComment[] = [];
    let after: string | null = null;
    let scanned = 0;

    do {
      const pageSize = Math.min(100, safeMax - scanned);
      if (pageSize <= 0) break;
      const query = new URLSearchParams({
        limit: String(pageSize),
        count: String(scanned),
        sort: 'new',
      });
      if (after !== null) query.set('after', after);
      const page = decode.comments(await this.get(`/user/${encodeURIComponent(user)}/comments?${query}`));
      scanned += page.items.length;
      for (const comment of page.items) {
        if (!wanted.has(comment.subreddit.toLowerCase())) continue;
        out.push(comment);
        if (out.length >= safeLimit) return out;
      }
      after = page.after;
      if (page.items.length === 0) break;
    } while (after !== null && scanned < safeMax);

    return out;
  }

  public async addModNote(
    rawSubreddit: string,
    rawUsername: string,
    note: string,
    label: MemberModNoteLabel,
  ): Promise<void> {
    const community = subreddit(rawSubreddit);
    const user = username(rawUsername);
    const text = note.trim();
    if (text.length === 0 || text.length > 250) throw new Error('Reddit Mod Note text must be from 1 to 250 characters');
    const form = new URLSearchParams({
      api_type: 'json',
      subreddit: community,
      user,
      note: text,
    });
    if (label !== 'NONE') form.set('label', label);
    await this.post('/api/mod/notes', form);
  }

  private async token(force = false): Promise<string> {
    const now = Date.now();
    if (!force && this.tokenCache !== null && this.tokenCache.until > now + 60_000) return this.tokenCache.value;
    const body = new URLSearchParams({
      grant_type: 'password',
      username: this.cfg.username,
      password: this.cfg.password,
    });
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
        body,
      });
    } catch {
      throw new RedditError('OAuth token request failed at the network boundary', 'network');
    }
    if (!response.ok) {
      throw new RedditError('OAuth token request was rejected', statusKind(response.status), response.status, retryAfterMs(response.headers));
    }
    const payload = await json(response, 'OAuth token request');
    if (!isMap(payload)) throw new RedditError('OAuth token response was not an object', 'invalid_response', response.status);
    const value = strVal(payload['access_token'], 'access_token');
    const seconds = numVal(payload['expires_in'], 'expires_in');
    if (value.length === 0 || seconds <= 0) throw new RedditError('OAuth token response was incomplete', 'invalid_response', response.status);
    this.tokenCache = { value, until: now + Math.floor(seconds * 1_000) };
    return value;
  }

  private async get(path: string): Promise<Json> {
    return await this.request(path, 'GET', null, false);
  }

  private async post(path: string, body: URLSearchParams): Promise<Json> {
    return await this.request(path, 'POST', body, false);
  }

  private async request(
    path: string,
    method: 'GET' | 'POST',
    body: URLSearchParams | null,
    reauthed: boolean,
  ): Promise<Json> {
    const url = new URL(`${api}${path}`);
    if (!url.searchParams.has('raw_json')) url.searchParams.set('raw_json', '1');
    let last: RedditError | null = null;

    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      const token = await this.token(reauthed && attempt === 0);
      let response: Response;
      try {
        response = await this.fetcher(url, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
            'user-agent': this.cfg.userAgent,
          },
          ...(body === null ? {} : { body }),
        });
      } catch {
        last = new RedditError(`Reddit ${method} request failed at the network boundary`, 'network');
        if (attempt + 1 < this.maxAttempts) {
          await this.sleep(backoffMs(attempt, this.random));
          continue;
        }
        throw last;
      }

      const payload = await json(response, `${method} ${url.pathname}`);
      if (response.ok) {
        const applicationError = firstApiError(payload);
        if (applicationError !== null) {
          throw new RedditError(`${method} ${url.pathname} rejected: ${applicationError}`, 'invalid_response', response.status);
        }
        return payload;
      }

      if (response.status === 401 && !reauthed) {
        this.tokenCache = null;
        return await this.request(path, method, body, true);
      }

      const kind = statusKind(response.status);
      const retry = retryAfterMs(response.headers);
      last = new RedditError(`${method} ${url.pathname} failed`, kind, response.status, retry);
      const retryable = kind === 'rate_limit' || kind === 'server';
      if (!retryable || attempt + 1 >= this.maxAttempts) throw last;
      await this.sleep(retry ?? backoffMs(attempt, this.random));
    }

    throw last ?? new RedditError(`Reddit ${method} request failed`, 'unknown');
  }
}
