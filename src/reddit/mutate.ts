import type { RedditAuthCfg } from '../env.ts';
import type { Json } from '../types/json.ts';
import { isMap, parseJson } from '../types/json.ts';
import { redditEmojiUploadLease, type RedditEmoji } from './emoji.ts';
import { RedditError, statusKind } from './error.ts';
import { backoffMs, rateFrom, retryAfterMs, type RedditRate } from './rate.ts';
import { rateLimitedRedditFetch } from './rateBudget.ts';
import type { RedditFlairTemplate } from './types.ts';

export type RedditMutationFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type RedditMutationSleep = (ms: number) => Promise<void>;

export type RedditMutationOptions = {
  readonly fetcher?: RedditMutationFetch;
  readonly uploadFetcher?: RedditMutationFetch;
  readonly sleep?: RedditMutationSleep;
  readonly random?: () => number;
  readonly maxAttempts?: number;
  readonly rateReserve?: number;
};

export type RedditCreatedPost = {
  readonly id: string;
  readonly fullname: string;
  readonly url: string;
};

export type RedditSelectedUserFlair = {
  readonly templateId: string | null;
  readonly text: string | null;
};

export type RedditEmojiMedia = {
  readonly bytes: ArrayBuffer;
  readonly filename: string;
  readonly mimeType: string;
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
const optionalText = (value: Json | undefined): string | null => typeof value === 'string' ? value : null;

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
  return { id, fullname, url: text(data['url']) };
};

const selectedUserFlair = (value: Json, username: string): RedditSelectedUserFlair => {
  if (!isMap(value) || !isMap(value['current'])) {
    throw new RedditError(`Reddit flair selector did not return current flair for u/${username}`, 'invalid_response');
  }
  const current = value['current'];
  return {
    templateId: optionalText(current['flair_template_id']),
    text: optionalText(current['flair_text']) ?? optionalText(current['text']),
  };
};

const add = (form: URLSearchParams, name: string, value: string | null): void => {
  if (value !== null && value.length > 0) form.set(name, value);
};

const modmailConversationId = (id: string): string => {
  const value = id.trim().replace(/^ModmailConversation_/u, '');
  if (!/^[A-Za-z0-9]+$/u.test(value)) throw new Error(`Invalid Reddit modmail conversation id ${id}`);
  return value;
};

const emojiName = (name: string): string => {
  const value = name.trim();
  if (!/^[A-Za-z0-9_-]{1,24}$/u.test(value)) throw new Error(`Invalid Reddit emoji name ${name}`);
  return value;
};

const emojiFile = (media: RedditEmojiMedia): RedditEmojiMedia => {
  const filename = media.filename.trim();
  const mimeType = media.mimeType.trim().toLowerCase();
  if (filename.length === 0 || filename.length > 255 || filename.includes('/') || filename.includes('\\')) {
    throw new Error(`Invalid Reddit emoji filename ${media.filename}`);
  }
  if (mimeType !== 'image/png' && mimeType !== 'image/jpeg') {
    throw new Error(`Unsupported Reddit emoji MIME type ${media.mimeType}`);
  }
  if (media.bytes.byteLength === 0) throw new Error('Reddit emoji image is empty');
  return { bytes: media.bytes, filename, mimeType };
};

const permissionForm = (emoji: RedditEmoji): URLSearchParams => new URLSearchParams({
  mod_flair_only: String(emoji.modFlairOnly),
  name: emojiName(emoji.name),
  post_flair_allowed: String(emoji.postFlairAllowed),
  user_flair_allowed: String(emoji.userFlairAllowed),
});

export class RedditMutationClient {
  private readonly fetcher: RedditMutationFetch;
  private readonly uploadFetcher: RedditMutationFetch;
  private readonly sleep: RedditMutationSleep;
  private readonly random: () => number;
  private readonly maxAttempts: number;
  private tokenCache: Token | null = null;
  private latestRate: RedditRate = { used: null, remaining: null, resetMs: null };

  public constructor(
    private readonly cfg: RedditAuthCfg,
    options: RedditMutationOptions = {},
  ) {
    this.sleep = options.sleep ?? defaultSleep;
    const rawFetcher = options.fetcher ?? fetch;
    this.fetcher = options.fetcher === undefined
      ? rateLimitedRedditFetch(rawFetcher, cfg.clientId, {
          reserve: options.rateReserve,
          sleep: this.sleep,
        })
      : rawFetcher;
    this.uploadFetcher = options.uploadFetcher ?? fetch;
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

  public async uploadEmoji(
    subreddit: string,
    emoji: RedditEmoji,
    input: RedditEmojiMedia,
  ): Promise<void> {
    const media = emojiFile(input);
    const name = emojiName(emoji.name);
    const lease = redditEmojiUploadLease(await this.form(
      `/api/v1/${encodeURIComponent(subreddit)}/emoji_asset_upload_s3.json`,
      new URLSearchParams({ filepath: media.filename, mimetype: media.mimeType }),
    ));

    const upload = new FormData();
    for (const [field, value] of lease.fields) upload.append(field, value);
    upload.append('file', new Blob([media.bytes], { type: media.mimeType }), media.filename);

    let response: Response;
    try {
      response = await this.uploadFetcher(lease.uploadUrl, { method: 'POST', body: upload });
    } catch {
      throw new RedditError(`Reddit emoji S3 upload failed for ${name}`, 'network');
    }
    if (!response.ok) {
      throw new RedditError(
        `Reddit emoji S3 upload failed for ${name}`,
        statusKind(response.status),
        response.status,
        retryAfterMs(response.headers),
      );
    }

    const form = permissionForm({ ...emoji, name });
    form.set('s3_key', lease.key);
    await this.form(`/api/v1/${encodeURIComponent(subreddit)}/emoji.json`, form);
  }

  public async updateEmojiPermissions(subreddit: string, emoji: RedditEmoji): Promise<void> {
    await this.form(
      `/api/v1/${encodeURIComponent(subreddit)}/emoji_permissions`,
      permissionForm(emoji),
    );
  }

  public async setUserFlairTemplate(
    subreddit: string,
    username: string,
    templateId: string,
    customText: string | null,
  ): Promise<void> {
    const form = new URLSearchParams({ api_type: 'json', flair_template_id: templateId, name: username });
    add(form, 'text', customText);
    await this.form(pathFor(subreddit, '/api/selectflair'), form);
  }

  public async userFlairSelection(subreddit: string, username: string): Promise<RedditSelectedUserFlair> {
    return selectedUserFlair(await this.form(
      pathFor(subreddit, '/api/flairselector'),
      new URLSearchParams({ api_type: 'json', name: username }),
    ), username);
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

  public async remove(fullname: string): Promise<void> {
    await this.form('/api/remove', new URLSearchParams({ api_type: 'json', id: fullname, spam: 'false' }));
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

  public async unbanUser(subreddit: string, username: string): Promise<void> {
    await this.form(pathFor(subreddit, '/api/unfriend'), new URLSearchParams({
      api_type: 'json',
      name: username,
      type: 'banned',
    }));
  }

  public async sendPrivateMessage(username: string, subject: string, body: string): Promise<void> {
    const form = new URLSearchParams({
      api_type: 'json',
      to: username,
      subject: subject.slice(0, 100),
      text: body,
    });
    await this.form('/api/compose', form);
  }

  public async replyToPrivateMessage(fullname: string, body: string): Promise<void> {
    if (!/^t4_[A-Za-z0-9]+$/u.test(fullname)) throw new Error(`Invalid Reddit private-message fullname ${fullname}`);
    await this.form('/api/comment', new URLSearchParams({
      api_type: 'json',
      thing_id: fullname,
      text: body,
    }));
  }

  public async markPrivateMessageRead(fullname: string): Promise<void> {
    if (!/^t4_[A-Za-z0-9]+$/u.test(fullname)) throw new Error(`Invalid Reddit private-message fullname ${fullname}`);
    await this.form('/api/read_message', new URLSearchParams({ id: fullname }));
  }

  public async replyModmail(
    conversationId: string,
    body: string,
    options: { readonly hidden?: boolean; readonly internal?: boolean } = {},
  ): Promise<void> {
    const id = modmailConversationId(conversationId);
    const textBody = body.trim();
    if (textBody.length === 0) throw new Error('Reddit modmail reply body cannot be empty');
    await this.form(`/api/mod/conversations/${encodeURIComponent(id)}`, new URLSearchParams({
      api_type: 'json',
      body: textBody,
      isAuthorHidden: String(options.hidden === true),
      isInternal: String(options.internal === true),
    }));
  }

  public async archiveModmail(conversationId: string): Promise<void> {
    const id = modmailConversationId(conversationId);
    await this.form(
      `/api/mod/conversations/${encodeURIComponent(id)}/archive`,
      new URLSearchParams({ api_type: 'json' }),
    );
  }

  public async muteModmail(conversationId: string, hours: 72 | 168 | 672): Promise<void> {
    const id = modmailConversationId(conversationId);
    await this.form(`/api/mod/conversations/${encodeURIComponent(id)}/mute`, new URLSearchParams({
      api_type: 'json',
      num_hours: String(hours),
    }));
  }

  public async unmuteModmail(conversationId: string): Promise<void> {
    const id = modmailConversationId(conversationId);
    await this.form(`/api/mod/conversations/${encodeURIComponent(id)}/unmute`, new URLSearchParams({ api_type: 'json' }));
  }

  public async muteUser(subreddit: string, username: string, note: string): Promise<void> {
    const form = new URLSearchParams({
      api_type: 'json',
      name: username,
      type: 'muted',
      duration: '28',
      note: note.slice(0, 300),
    });
    await this.form(pathFor(subreddit, '/api/friend'), form);
  }

  public async unmuteUser(subreddit: string, username: string): Promise<void> {
    await this.form(pathFor(subreddit, '/api/unfriend'), new URLSearchParams({
      api_type: 'json',
      name: username,
      type: 'muted',
    }));
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
