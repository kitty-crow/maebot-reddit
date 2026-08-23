import type { RedditAuthCfg } from '../env.ts';
import type { Json } from '../types/json.ts';
import { isMap, parseJson } from '../types/json.ts';
import { numVal, strVal } from '../types/value.ts';
import * as decode from './decode.ts';
import { RedditError, statusKind } from './error.ts';
import { backoffMs, rateFrom, retryAfterMs, type RedditRate } from './rate.ts';
import type {
  RedditAccount,
  RedditComment,
  RedditFlairAssignment,
  RedditFlairTemplate,
  RedditModerator,
  RedditPost,
  RedditSubreddit,
} from './types.ts';

export type RedditFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type RedditSleep = (ms: number) => Promise<void>;

export type RedditClientOptions = {
  readonly fetcher?: RedditFetch;
  readonly sleep?: RedditSleep;
  readonly random?: () => number;
  readonly maxAttempts?: number;
};

type Token = {
  readonly value: string;
  readonly until: number;
};

const defaultSleep: RedditSleep = async ms => await new Promise(resolve => setTimeout(resolve, ms));
const api = 'https://oauth.reddit.com';
const tokenApi = 'https://www.reddit.com/api/v1/access_token';

const pathFor = (subreddit: string, suffix: string): string =>
  `/r/${encodeURIComponent(subreddit)}${suffix}`;

const json = async (response: Response, context: string): Promise<Json> => {
  try {
    return parseJson(await response.text());
  } catch {
    throw new RedditError(`${context} returned invalid JSON`, 'invalid_response', response.status);
  }
};

export class RedditReadClient {
  private readonly fetcher: RedditFetch;
  private readonly sleep: RedditSleep;
  private readonly random: () => number;
  private readonly maxAttempts: number;
  private tokenCache: Token | null = null;
  private latestRate: RedditRate = { used: null, remaining: null, resetMs: null };

  public constructor(
    private readonly cfg: RedditAuthCfg,
    options: RedditClientOptions = {},
  ) {
    this.fetcher = options.fetcher ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
    this.maxAttempts = Math.max(1, Math.min(8, Math.floor(options.maxAttempts ?? 4)));
  }

  public rate(): RedditRate {
    return this.latestRate;
  }

  public async me(): Promise<RedditAccount> {
    return decode.account(await this.get('/api/v1/me'));
  }

  public async subreddit(name: string): Promise<RedditSubreddit> {
    return decode.subreddit(await this.get(pathFor(name, '/about')));
  }

  public async moderators(name: string): Promise<readonly RedditModerator[]> {
    return await this.pages(pathFor(name, '/about/moderators'), 100, decode.moderators);
  }

  public async bannedUsers(name: string): Promise<readonly decode.RedditRelationshipUser[]> {
    return await this.pages(pathFor(name, '/about/banned'), 100, value => decode.relationshipUsers(value, 'banned users'));
  }

  public async userFlairTemplates(name: string): Promise<readonly RedditFlairTemplate[]> {
    return decode.flairTemplates(await this.get(pathFor(name, '/api/user_flair_v2')));
  }

  public async postFlairTemplates(name: string): Promise<readonly RedditFlairTemplate[]> {
    return decode.flairTemplates(await this.get(pathFor(name, '/api/link_flair_v2')));
  }

  public async userFlairAssignments(name: string): Promise<readonly RedditFlairAssignment[]> {
    const out: RedditFlairAssignment[] = [];
    let after: string | null = null;
    let count = 0;
    do {
      const query = new URLSearchParams({ limit: '1000', count: String(count) });
      if (after !== null) query.set('after', after);
      const page = decode.flairAssignments(await this.get(`${pathFor(name, '/api/flairlist')}?${query}`));
      out.push(...page.assignments);
      count = out.length;
      after = page.next;
    } while (after !== null);
    return out;
  }

  public async rules(name: string): Promise<decode.RulesPayload> {
    return decode.rules(await this.get(pathFor(name, '/about/rules')));
  }

  public async sticky(name: string, slot: 1 | 2): Promise<RedditPost | null> {
    try {
      return decode.sticky(await this.get(`${pathFor(name, '/sticky')}?num=${slot}`));
    } catch (error) {
      if (error instanceof RedditError && error.kind === 'not_found') return null;
      throw error;
    }
  }

  public async hotPosts(name: string, limit = 100): Promise<readonly RedditPost[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    return decode.posts(await this.get(`${pathFor(name, '/hot')}?limit=${safeLimit}`), 'hot posts').items;
  }

  public async newPosts(name: string, limit = 25): Promise<readonly RedditPost[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    return decode.posts(await this.get(`${pathFor(name, '/new')}?limit=${safeLimit}`)).items;
  }

  public async newComments(name: string, limit = 25): Promise<readonly RedditComment[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    return decode.comments(await this.get(`${pathFor(name, '/comments')}?limit=${safeLimit}`)).items;
  }

  public async newPostsHistory(name: string, maxItems = 1000): Promise<readonly RedditPost[]> {
    const max = Math.max(1, Math.min(1000, Math.floor(maxItems)));
    return await this.pages(pathFor(name, '/new'), 100, value => decode.posts(value, 'new posts'), max);
  }

  public async newCommentsHistory(name: string, maxItems = 1000): Promise<readonly RedditComment[]> {
    const max = Math.max(1, Math.min(1000, Math.floor(maxItems)));
    return await this.pages(pathFor(name, '/comments'), 100, decode.comments, max);
  }

  private async pages<T>(
    path: string,
    pageLimit: number,
    decoder: (value: Json) => decode.RedditListing<T>,
    maxItems = Number.MAX_SAFE_INTEGER,
  ): Promise<readonly T[]> {
    const out: T[] = [];
    let after: string | null = null;
    do {
      const remaining = Math.max(0, maxItems - out.length);
      if (remaining === 0) break;
      const limit = Math.max(1, Math.min(pageLimit, remaining));
      const query = new URLSearchParams({ limit: String(limit), count: String(out.length) });
      if (after !== null) query.set('after', after);
      const page = decoder(await this.get(`${path}?${query}`));
      out.push(...page.items.slice(0, remaining));
      after = page.after;
    } while (after !== null && out.length < maxItems);
    return out;
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
    return await this.request(path, false);
  }

  private async request(path: string, reauthed: boolean): Promise<Json> {
    const url = new URL(`${api}${path}`);
    if (!url.searchParams.has('raw_json')) url.searchParams.set('raw_json', '1');

    let last: RedditError | null = null;
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      const token = await this.token(reauthed && attempt === 0);
      let response: Response;
      try {
        response = await this.fetcher(url, {
          headers: {
            authorization: `Bearer ${token}`,
            'user-agent': this.cfg.userAgent,
          },
        });
      } catch {
        last = new RedditError('Reddit request failed at the network boundary', 'network');
        if (attempt + 1 < this.maxAttempts) {
          await this.sleep(backoffMs(attempt, this.random));
          continue;
        }
        throw last;
      }

      this.latestRate = rateFrom(response.headers);
      if (response.ok) return await json(response, `GET ${url.pathname}`);

      if (response.status === 401 && !reauthed) {
        this.tokenCache = null;
        return await this.request(path, true);
      }

      const kind = statusKind(response.status);
      const retry = retryAfterMs(response.headers);
      last = new RedditError(`GET ${url.pathname} failed`, kind, response.status, retry);
      const retryable = kind === 'rate_limit' || kind === 'server';
      if (!retryable || attempt + 1 >= this.maxAttempts) throw last;
      await this.sleep(retry ?? backoffMs(attempt, this.random));
    }
    throw last ?? new RedditError('Reddit request failed', 'unknown');
  }
}
