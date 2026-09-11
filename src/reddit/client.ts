import type { RedditAuthCfg } from '../env.ts';
import { directMessages } from '../dm/decode.ts';
import type { RedditDirectMessage } from '../dm/types.ts';
import { modmailConversation, modmailConversations } from '../modmail/decode.ts';
import type { ModmailConversation, ModmailConversationPage } from '../modmail/types.ts';
import type { Json } from '../types/json.ts';
import { isMap, parseJson } from '../types/json.ts';
import { numVal, strVal } from '../types/value.ts';
import * as decode from './decode.ts';
import { redditEmojis, type RedditEmoji } from './emoji.ts';
import { RedditError, statusKind } from './error.ts';
import { backoffMs, rateFrom, retryAfterMs, type RedditRate } from './rate.ts';
import { rateLimitedRedditFetch } from './rateBudget.ts';
import { thingScores } from './scoreDecode.ts';
import type {
  RedditAccount,
  RedditComment,
  RedditFlairAssignment,
  RedditFlairTemplate,
  RedditModerator,
  RedditPost,
  RedditSubreddit,
  RedditThingScore,
} from './types.ts';

export type RedditFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type RedditSleep = (ms: number) => Promise<void>;

export type RedditClientOptions = {
  readonly fetcher?: RedditFetch;
  readonly sleep?: RedditSleep;
  readonly random?: () => number;
  readonly maxAttempts?: number;
  readonly rateReserve?: number;
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

const sameUsername = (left: string, right: string): boolean => left.trim().toLowerCase() === right.trim().toLowerCase();

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

  public async bannedUser(name: string, username: string): Promise<decode.RedditRelationshipUser | null> {
    const query = new URLSearchParams({ limit: '1', user: username });
    const page = decode.relationshipUsers(
      await this.get(`${pathFor(name, '/about/banned')}?${query}`),
      'banned user',
    );
    return page.items.find(item => sameUsername(item.username, username)) ?? null;
  }

  public async mutedUsers(name: string): Promise<readonly decode.RedditRelationshipUser[]> {
    return await this.pages(pathFor(name, '/about/muted'), 100, value => decode.relationshipUsers(value, 'muted users'));
  }

  public async mutedUser(name: string, username: string): Promise<decode.RedditRelationshipUser | null> {
    const query = new URLSearchParams({ limit: '1', user: username });
    const page = decode.relationshipUsers(
      await this.get(`${pathFor(name, '/about/muted')}?${query}`),
      'muted user',
    );
    return page.items.find(item => sameUsername(item.username, username)) ?? null;
  }

  public async emojis(name: string): Promise<readonly RedditEmoji[]> {
    return redditEmojis(await this.get(`/api/v1/${encodeURIComponent(name)}/emojis/all`));
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

  public async userFlairAssignment(name: string, username: string): Promise<RedditFlairAssignment | null> {
    const query = new URLSearchParams({ limit: '1', name: username });
    const page = decode.flairAssignments(await this.get(`${pathFor(name, '/api/flairlist')}?${query}`));
    return page.assignments.find(item => sameUsername(item.username, username)) ?? null;
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

  public async inboxDirectMessages(maxItems = 1000): Promise<readonly RedditDirectMessage[]> {
    const max = Math.max(1, Math.min(1000, Math.floor(maxItems)));
    return await this.pages('/message/inbox', 100, value => {
      const page = directMessages(value, 'private message inbox');
      return { items: page.messages, after: page.after };
    }, max);
  }

  public async unreadDirectMessages(maxItems = 1000): Promise<readonly RedditDirectMessage[]> {
    const max = Math.max(1, Math.min(1000, Math.floor(maxItems)));
    return await this.pages('/message/unread', 100, value => {
      const page = directMessages(value, 'unread private messages');
      return { items: page.messages, after: page.after };
    }, max);
  }

  public async sentDirectMessages(maxItems = 1000): Promise<readonly RedditDirectMessage[]> {
    const max = Math.max(1, Math.min(1000, Math.floor(maxItems)));
    return await this.pages('/message/sent', 100, value => {
      const page = directMessages(value, 'sent private messages');
      return { items: page.messages, after: page.after };
    }, max);
  }

  public async modmailConversations(name: string, limit = 100): Promise<ModmailConversationPage> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const query = new URLSearchParams({
      entity: name,
      limit: String(safeLimit),
      sort: 'recent',
      state: 'all',
    });
    return modmailConversations(await this.get(`/api/mod/conversations?${query}`));
  }

  public async modmailConversation(id: string, markRead = false): Promise<ModmailConversation> {
    const value = id.trim().replace(/^ModmailConversation_/u, '');
    if (!/^[A-Za-z0-9]+$/u.test(value)) throw new Error(`Invalid Reddit modmail conversation id ${id}`);
    const query = new URLSearchParams({ markRead: String(markRead) });
    return modmailConversation(await this.get(`/api/mod/conversations/${encodeURIComponent(value)}?${query}`));
  }

  public async scores(fullnames: readonly string[]): Promise<readonly RedditThingScore[]> {
    if (fullnames.length === 0) return [];
    const values = [...new Set(fullnames.map(value => value.trim()))];
    if (values.length > 100) throw new Error('Reddit score inventory reads are limited to 100 fullnames per request');
    for (const fullname of values) {
      if (!/^(?:t1|t3)_[A-Za-z0-9]+$/u.test(fullname)) throw new Error(`Invalid Reddit fullname ${fullname}`);
    }
    const query = new URLSearchParams({ id: values.join(',') });
    return thingScores(await this.get(`/api/info?${query}`));
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
