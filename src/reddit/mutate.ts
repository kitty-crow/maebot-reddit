import type { RedditAuthCfg } from '../env.ts';
import { assertRedditStateMutationAllowed } from '../reputation/manualOverrideGate.ts';
import { isMap, type Json } from '../types/json.ts';
import { RedditError, statusKind } from './error.ts';
import { redditEmojiUploadLease, type RedditEmoji } from './emoji.ts';
import type { RedditRate } from './rate.ts';
import type { RedditFlairTemplate } from './types.ts';
import {
  devvitRpcClient,
  redditCall,
  redditChain,
  wireMap,
  wireMaybeText,
  wireText,
} from './devvitCompat.ts';
import { DevvitRpcClient } from './devvitRpc.ts';
import { legacyRedditApi, type LegacyRedditApi } from './legacyApi.ts';
import { retryAfterMs } from './rate.ts';

export type RedditMutationFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type RedditMutationSleep = (ms: number) => Promise<void>;

export type RedditMutationOptions = {
  readonly fetcher?: RedditMutationFetch;
  readonly uploadFetcher?: RedditMutationFetch;
  readonly sleep?: RedditMutationSleep;
  readonly random?: () => number;
  readonly maxAttempts?: number;
  readonly rateReserve?: number;
  readonly rpc?: DevvitRpcClient;
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

const emptyRate: RedditRate = { used: null, remaining: null, resetMs: null };

const post = (value: Awaited<ReturnType<typeof redditCall>>): RedditCreatedPost => {
  const raw = wireMap(value, 'Devvit created post');
  const id = wireText(raw['id'], 'Devvit created post id');
  return {
    id: id.startsWith('t3_') ? id.slice(3) : id,
    fullname: id.startsWith('t3_') ? id : `t3_${id}`,
    url: wireText(raw['url'], 'Devvit created post url', ''),
  };
};
const legacyCreatedPost = (value: Json): RedditCreatedPost => {
  if (!isMap(value) || !isMap(value['json']) || !isMap(value['json']['data'])) {
    throw new RedditError('Reddit legacy submit response did not contain post data', 'invalid_response');
  }
  const data = value['json']['data'];
  const id = data['id'];
  if (typeof id !== 'string' || id.length === 0) {
    throw new RedditError('Reddit legacy submit response did not contain a post id', 'invalid_response');
  }
  const fullname = typeof data['name'] === 'string' && data['name'].length > 0
    ? data['name']
    : `t3_${id}`;
  const url = typeof data['url'] === 'string' ? data['url'] : '';
  return { id, fullname, url };
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


const validModmailId = (id: string): string => {
  const value = id.trim().replace(/^ModmailConversation_/u, '');
  if (!/^[A-Za-z0-9]+$/u.test(value)) throw new Error(`Invalid Reddit modmail conversation id ${id}`);
  return value;
};

export class RedditMutationClient {
  private readonly rpc: DevvitRpcClient;
  private readonly legacy: LegacyRedditApi | null;
  private readonly forceLegacy: boolean;

  public constructor(
    cfg: RedditAuthCfg,
    options: RedditMutationOptions = {},
  ) {
    this.rpc = options.rpc ?? devvitRpcClient(cfg);
    this.legacy = legacyRedditApi(cfg, options.fetcher);
    this.forceLegacy = cfg.transport === 'legacy';
  }

  public rate(): RedditRate {
    return emptyRate;
  }

  public async submitSelf(
    subreddit: string,
    title: string,
    body: string,
    flairTemplateId: string | null = null,
  ): Promise<RedditCreatedPost> {
    if (this.forceLegacy) {
      if (this.legacy === null) throw new Error('Legacy Reddit transport is not configured');
      const form = new URLSearchParams({
        api_type: 'json',
        kind: 'self',
        resubmit: 'true',
        sendreplies: 'true',
        sr: subreddit,
        text: body,
        title,
      });
      if (flairTemplateId !== null) form.set('flair_id', flairTemplateId);
      return legacyCreatedPost(await this.legacy.form('/api/submit', form));
    }
    return post(await redditCall(this.rpc, 'submitPost', [{
      subredditName: subreddit,
      title,
      text: body,
      sendreplies: true,
      ...(flairTemplateId === null ? {} : { flairId: flairTemplateId }),
    }]));
  }

  public async crosspost(
    subreddit: string,
    sourcePostId: string,
    title: string,
    flairTemplateId: string | null = null,
  ): Promise<RedditCreatedPost> {
    const postId = sourcePostId.startsWith('t3_') ? sourcePostId : `t3_${sourcePostId}`;
    if (this.forceLegacy) {
      if (this.legacy === null) throw new Error('Legacy Reddit transport is not configured');
      const form = new URLSearchParams({
        api_type: 'json',
        crosspost_fullname: postId,
        kind: 'crosspost',
        resubmit: 'true',
        sendreplies: 'true',
        sr: subreddit,
        title,
      });
      if (flairTemplateId !== null) form.set('flair_id', flairTemplateId);
      return legacyCreatedPost(await this.legacy.form('/api/submit', form));
    }
    return post(await redditCall(this.rpc, 'crosspost', [{
      subredditName: subreddit,
      postId,
      title,
      sendreplies: true,
      ...(flairTemplateId === null ? {} : { flairId: flairTemplateId }),
    }]));
  }

  public async createFlairTemplate(
    subreddit: string,
    kind: 'user' | 'post',
    template: RedditFlairTemplate,
  ): Promise<void> {
    const options = {
      subredditName: subreddit,
      text: template.text,
      modOnly: template.modOnly,
      allowUserEdits: template.textEditable,
      ...(template.backgroundColour === null ? {} : { backgroundColor: template.backgroundColour }),
      ...(template.textColour === 'light' || template.textColour === 'dark'
        ? { textColor: template.textColour }
        : {}),
      ...(template.allowableContent === 'all'
        || template.allowableContent === 'emoji'
        || template.allowableContent === 'text'
        ? { allowableContent: template.allowableContent }
        : {}),
      ...(template.maxEmojis === null ? {} : { maxEmojis: template.maxEmojis }),
    };
    await redditCall(this.rpc, kind === 'user' ? 'createUserFlairTemplate' : 'createPostFlairTemplate', [options]);
  }

  public async uploadEmoji(
    subreddit: string,
    emoji: RedditEmoji,
    input: RedditEmojiMedia,
  ): Promise<void> {
    if (this.legacy === null) {
      throw new Error('Reddit custom emoji upload requires legacy Reddit OAuth fallback');
    }
    const media = emojiFile(input);
    const name = emojiName(emoji.name);
    const lease = redditEmojiUploadLease(await this.legacy.form(
      `/api/v1/${encodeURIComponent(subreddit)}/emoji_asset_upload_s3.json`,
      new URLSearchParams({ filepath: media.filename, mimetype: media.mimeType }),
    ));

    const upload = new FormData();
    for (const [field, value] of lease.fields) upload.append(field, value);
    upload.append('file', new Blob([media.bytes], { type: media.mimeType }), media.filename);

    const response = await this.legacy.upload(lease.uploadUrl, upload);
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
    await this.legacy.form(`/api/v1/${encodeURIComponent(subreddit)}/emoji.json`, form);
  }

  public async updateEmojiPermissions(subreddit: string, emoji: RedditEmoji): Promise<void> {
    if (this.legacy === null) {
      throw new Error('Reddit custom emoji permission management requires legacy Reddit OAuth fallback');
    }
    await this.legacy.form(
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
    assertRedditStateMutationAllowed(username);
    await redditCall(this.rpc, 'setUserFlair', [{
      subredditName: subreddit,
      username,
      flairTemplateId: templateId,
      ...(customText === null ? {} : { text: customText }),
    }]);
  }

  public async userFlairSelection(subreddit: string, username: string): Promise<RedditSelectedUserFlair> {
    if (this.legacy === null) {
      throw new Error('Reddit user-flair selection requires legacy Reddit OAuth fallback');
    }
    const value = await this.legacy.form(
      `/r/${encodeURIComponent(subreddit)}/api/flairselector`,
      new URLSearchParams({ api_type: 'json', name: username }),
    );
    if (!isMap(value) || !isMap(value['current'])) {
      throw new RedditError(
        `Reddit flair selector did not return current flair for u/${username}`,
        'invalid_response',
      );
    }
    const current = value['current'];
    const text = (raw: Json | undefined): string | null =>
      typeof raw === 'string' && raw.length > 0 ? raw : null;
    return {
      templateId: text(current['flair_template_id']),
      text: text(current['flair_text']) ?? text(current['text']),
    };
  }

  public async setUserFlairDirect(
    subreddit: string,
    username: string,
    flairText: string | null,
    cssClass: string | null,
  ): Promise<void> {
    assertRedditStateMutationAllowed(username);
    await redditCall(this.rpc, 'setUserFlair', [{
      subredditName: subreddit,
      username,
      text: flairText ?? '',
      cssClass: cssClass ?? '',
    }]);
  }

  public async setPostFlairTemplate(
    subreddit: string,
    postId: string,
    templateId: string,
    customText: string | null = null,
  ): Promise<void> {
    await redditCall(this.rpc, 'setPostFlair', [{
      subredditName: subreddit,
      postId: postId.startsWith('t3_') ? postId : `t3_${postId}`,
      flairTemplateId: templateId,
      ...(customText === null ? {} : { text: customText }),
    }]);
  }

  public async remove(fullname: string): Promise<void> {
    await redditCall(this.rpc, 'remove', [fullname, false]);
  }

  public async banUser(
    subreddit: string,
    username: string,
    reason: string,
    note: string,
  ): Promise<void> {
    assertRedditStateMutationAllowed(username);
    await redditCall(this.rpc, 'banUser', [{
      subredditName: subreddit,
      username,
      reason: reason.slice(0, 100),
      note: note.slice(0, 300),
    }]);
  }

  public async unbanUser(subreddit: string, username: string): Promise<void> {
    assertRedditStateMutationAllowed(username);
    await redditCall(this.rpc, 'unbanUser', [username, subreddit]);
  }

  public async sendPrivateMessage(username: string, subject: string, body: string): Promise<void> {
    await redditCall(this.rpc, 'sendPrivateMessage', [{
      to: username,
      subject: subject.slice(0, 100),
      text: body,
    }]);
  }

  public async replyToPrivateMessage(fullname: string, body: string): Promise<void> {
    if (!/^t4_[A-Za-z0-9]+$/u.test(fullname)) {
      throw new Error(`Invalid Reddit private-message fullname ${fullname}`);
    }
    if (this.legacy === null) {
      throw new Error('Reddit private-message replies require legacy Reddit OAuth fallback');
    }
    await this.legacy.form('/api/comment', new URLSearchParams({
      api_type: 'json',
      thing_id: fullname,
      text: body,
    }));
  }

  public async markPrivateMessageRead(fullname: string): Promise<void> {
    if (!/^t4_[A-Za-z0-9]+$/u.test(fullname)) {
      throw new Error(`Invalid Reddit private-message fullname ${fullname}`);
    }
    if (this.legacy === null) {
      throw new Error('Reddit private-message read state requires legacy Reddit OAuth fallback');
    }
    await this.legacy.form('/api/read_message', new URLSearchParams({ id: fullname }));
  }

  public async replyModmail(
    conversationId: string,
    body: string,
    options: { readonly hidden?: boolean; readonly internal?: boolean } = {},
  ): Promise<void> {
    const id = validModmailId(conversationId);
    const text = body.trim();
    if (text.length === 0) throw new Error('Reddit modmail reply body cannot be empty');
    await redditChain(this.rpc, [
      { kind: 'get', name: 'modMail' },
      {
        kind: 'call',
        name: 'reply',
        args: [{
          conversationId: id,
          body: text,
          isAuthorHidden: options.hidden === true,
          isInternal: options.internal === true,
        }],
      },
    ]);
  }

  public async archiveModmail(conversationId: string): Promise<void> {
    await redditChain(this.rpc, [
      { kind: 'get', name: 'modMail' },
      { kind: 'call', name: 'archiveConversation', args: [validModmailId(conversationId)] },
    ]);
  }

  public async muteModmail(conversationId: string, hours: 72 | 168 | 672): Promise<void> {
    await redditChain(this.rpc, [
      { kind: 'get', name: 'modMail' },
      {
        kind: 'call',
        name: 'muteConversation',
        args: [{ conversationId: validModmailId(conversationId), numHours: hours }],
      },
    ]);
  }

  public async unmuteModmail(conversationId: string): Promise<void> {
    await redditChain(this.rpc, [
      { kind: 'get', name: 'modMail' },
      { kind: 'call', name: 'unmuteConversation', args: [validModmailId(conversationId)] },
    ]);
  }

  public async muteUser(subreddit: string, username: string, note: string): Promise<void> {
    assertRedditStateMutationAllowed(username);
    await redditCall(this.rpc, 'muteUser', [{
      subredditName: subreddit,
      username,
      note: note.slice(0, 300),
    }]);
  }

  public async unmuteUser(subreddit: string, username: string): Promise<void> {
    assertRedditStateMutationAllowed(username);
    await redditCall(this.rpc, 'unmuteUser', [username, subreddit]);
  }

  public async sticky(postId: string, slot: 1 | 2): Promise<void> {
    await redditChain(this.rpc, [
      { kind: 'call', name: 'getPostById', args: [postId.startsWith('t3_') ? postId : `t3_${postId}`] },
      { kind: 'call', name: 'sticky', args: [slot] },
    ]);
  }
}
