import type { RedditAuthCfg } from '../env.ts';
import type { Json } from '../types/json.ts';
import { isMap, parseJson } from '../types/json.ts';
import { RedditError, statusKind } from './error.ts';
import { backoffMs, rateFrom, retryAfterMs, type RedditRate } from './rate.ts';
import type { RedditFlairTemplate } from './types.ts';

export type RedditMutationFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type RedditMutationSleep = (ms: number) => Promise<void>;

export type RedditMutationOptions = {
  readonly fetcher?: RedditMutationFetch;
  readonly sleep?: RedditMutationSleep;
  readonly random?: () => number;
  readonly maxAttempts?: number;
};

export type RedditCreatedPost = {
  readonly id: string;
  readonly fullname: string;
  readonly url: string;
};

type Token = {
  readonly value: string;
  readonly until: number;
};

const api = 'https://oauth.reddit.com';
const tokenApi = 'https://www.reddit.com/api/v1/access_token';
const defaultSleep: RedditMutationSleep = async ms => await new Promise(resolve => setTimeout(resolve, ms));

const pathFor = (subreddit: string, suffix: string): string =>
  `/r/${encodeURIComponent(subreddit)}${suffix}`;

const text = (value: Json | undefined): string => typeof value === 'string' ? value : '';

const jsonPayload = (raw: string, context: string): Json => {
  if (raw.trim().length === 0) return null;
  try {
    return parseJson(raw);
  } catch {
    throw new RedditError(`${context} returned invalid JSON`, 'invalid_response');
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

const createdPost = (value: Json): RedditCreatedPost => {
  if (!isMap(value)) throw new RedditError('Reddit submit response was not an object', 'invalid_response');
  const envelope = value['json'];
  if (!isMap(envelope)) throw new RedditError('Reddit submit response did not contain json', 'invalid_response');
  const data = envelope['data'];
  if (!isMap(data)) throw new RedditError('Reddit submit response did not contain data', 'invalid_response');
  const id = text(data['id']);
  if (id.length === 0) throw new RedditError('Reddit submit response did not contain a post id', 'invalid_response');
  const fullname = text(data['name']) || `t3_${id}`;
  return {
    id,
    fullname,
    url: text(data['url']),
  };
};

const add = (form: URLSearchParams, name: string, value: string | null): void => {
  if (value !== null && value.length > 0) form.set(name, value);
};

export class RedditMutationClient {
  private readonly fetcher: RedditMutationFetch;
  private readonly sleep: RedditMutationSleep;
  private readonly random: () => number;
  private readonly maxAttempts: number;
  private tokenCache: Token | null = null;
  private latestRate: RedditRate = { used: null, remaining: null, resetMs: null };

  public constructor(
    private readonly cfg: RedditAuthCfg,
    options: RedditMutationOptions = {},
  ) {
    this.fetcher = options.fetcher ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
    this.maxAttempts = Math.max(1, Math.min(8, Math.floor(options.maxAttempts ?? 4)));
  }

  public rate(): RedditRate {
    return this.latestRate;
  }

  public async submitSelf(
    subreddit: string,
    title: string,
    body: string,
    flairTemplateId: string | null = null,
  ): Promise<RedditCreatedPost> {
    const form = new URLSearchParams({
      api_type: 'json',
      kind: 'self',
      resubmit: 'true',
      sendreplies: 'true',
      sr: subreddit,
      text: body,
      title,
    });
    add(form, 'flair_id', flairTemplateId);
    return createdPost(await this.form('/api/submit', form));
  }

  public async crosspost(
    subreddit: string,
    sourcePostId: string,
    title: string,
    flairTemplateId: string | null = null,
  ): Promise<RedditCreatedPost> {
    const fullname = sourcePostId.startsWith('t3_') ? sourcePostId : `t3_${sourcePostId}`;
    const form = new URLSearchParams({
      api_type: 'json',
      crosspost_fullname: fullname,
      kind: 'crosspost',
      nsfw: 'false',
      sendreplies: 'true',
      spoiler: 'false',
      sr: subreddit,
      title,
    });
    add(form, 'flair_id', flairTemplateId);
    return createdPost(await this.form('/api/submit', form));
  }

  public async createFlairTemplate(
    subreddit: string,
    kind: 'user' | 'post',
    template: RedditFlairTemplate,
  ): Promise<void> {
    const form = new URLSearchParams({
      api_type: 'json',
      flair_type: kind === 'user' ? 'USER_FLAIR' : 'LINK_FLAIR',
      mod_only: String(template.modOnly),
      text: template.text,
      text_editable: String(template.textEditable),
    });
    add(form, 'css_class', template.cssClass);
    add(form, 'background_color', template.backgroundColour);
    if (template.textColour === 'light' || template.textColour === 'dark') form.set('text_color', template.textColour);
    if (template.allowableContent === 'all' || template.allowableContent === 'emoji' || template.allowableContent === 'text') {
      form.set('allowable_content', template.allowableContent);
    }
    if (template.maxEmojis !== null && Number.isSafeInteger(template.maxEmojis) && template.maxEmojis >= 1 && template.maxEmojis <= 10) {
      form.set('max_emojis', String(template.maxEmojis));
    }
    await this.form(pathFor(subreddit, '/api/flairtemplate_v2'), form);
  }

  public async setUserFlairTemplate(
    subreddit: string,
    username: string,
    templateId: string,
    customText: string | null,
  ): Promise<void> {
    const form = new URLSearchParams({
      api_type: 'json',
      flair_template_id: templateId,
      name: username,
    });
    add(form, 'text', customText);
    await this.form(pathFor(subreddit, '/api/selectflair'), form);
  }

  public async setUserFlairDirect(
    subreddit: string,
    username: string,
    flairText: string | null,
    cssClass: string | null,
  ): Promise<void> {
    const form = new URLSearchParams({
      api_type: 'json',
      name: username,
      text: flairText ?? '',
      css_class: cssClass ?? '',
    });
    await this.form(pathFor(subreddit, '/api/flair'), form);
  }

  public async setPostFlairTemplate(
    subreddit: string,
    postId: string,
    templateId: string,
    customText: string | null = null,
  ): Promise<void> {
    const form = new URLSearchParams({
      api_type: 'json',
      flair_template_id: templateId,
      link: postId.startsWith('t3_') ? postId : `t3_${postId}`,
    });
    add(form, 'text', customText);
    await this.form(pathFor(subreddit, '/api/selectflair'), form);
  }

  public async banUser(
    subreddit: string,
    username: string,
    reason: string,
    note: string,
  ): Promise<void> {
    const form = new URLSearchParams({
      api_type: 'json',
      name: username,
      type: 'banned',
      ban_reason: reason.slice(0, 100),
      note: note.slice(0, 300),
    });
    await this.form(pathFor(subreddit, '/api/friend'), form);
  }

  public async sticky(postId: string, slot: 1 | 2): Promise<void> {
    const form = new URLSearchParams({
      api_type: 'json',
      id: postId.startsWith('t3_') ? postId : `t3_${postId}`,
      num: String(slot),
      state: 'true',
      to_profile: 'false',
    });
    await this.form('/api/set_subreddit_sticky', form);
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
    const payload = jsonPayload(await response.text(), 'OAuth token request');
    if (!isMap(payload)) throw new RedditError('OAuth token response was not an object', 'invalid_response', response.status);
    const value = text(payload['access_token']);
    const seconds = payload['expires_in'];
    if (value.length === 0 || typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
      throw new RedditError('OAuth token response was incomplete', 'invalid_response', response.status);
    }
    this.tokenCache = { value, until: now + Math.floor(seconds * 1_000) };
    return value;
  }

  private async form(path: string, body: URLSearchParams): Promise<Json> {
    return await this.request(path, body, false);
  }

  private async request(path: string, body: URLSearchParams, reauthed: boolean): Promise<Json> {
    const url = new URL(`${api}${path}`);
    if (!url.searchParams.has('raw_json')) url.searchParams.set('raw_json', '1');

    let last: RedditError | null = null;
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      const token = await this.token(reauthed && attempt === 0);
      let response: Response;
      try {
        response = await this.fetcher(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/x-www-form-urlencoded',
            'user-agent': this.cfg.userAgent,
          },
          body,
        });
      } catch {
        last = new RedditError('Reddit mutation request failed at the network boundary', 'network');
        if (attempt + 1 < this.maxAttempts) {
          await this.sleep(backoffMs(attempt, this.random));
          continue;
        }
        throw last;
      }

      this.latestRate = rateFrom(response.headers);
      const raw = await response.text();
      if (response.ok) {
        const payload = jsonPayload(raw, `POST ${url.pathname}`);
        const applicationError = firstApiError(payload);
        if (applicationError !== null) {
          throw new RedditError(`POST ${url.pathname} rejected: ${applicationError}`, 'invalid_response', response.status);
        }
        return payload;
      }

      if (response.status === 401 && !reauthed) {
        this.tokenCache = null;
        return await this.request(path, body, true);
      }

      const kind = statusKind(response.status);
      const retry = retryAfterMs(response.headers);
      last = new RedditError(`POST ${url.pathname} failed`, kind, response.status, retry);
      const retryable = kind === 'rate_limit' || kind === 'server';
      if (!retryable || attempt + 1 >= this.maxAttempts) throw last;
      await this.sleep(retry ?? backoffMs(attempt, this.random));
    }
    throw last ?? new RedditError('Reddit mutation request failed', 'unknown');
  }
}
