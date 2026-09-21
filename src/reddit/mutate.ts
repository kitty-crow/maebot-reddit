import type { RedditAuthCfg } from '../env.ts';
import { assertRedditStateMutationAllowed } from '../reputation/manualOverrideGate.ts';
import type { RedditEmoji } from './emoji.ts';
import type { RedditRate } from './rate.ts';
import type { RedditFlairTemplate } from './types.ts';
import {
  devvitRpcClient,
  redditCall,
  redditChain,
  wireArray,
  wireMap,
  wireMaybeText,
  wireText,
} from './devvitCompat.ts';
import { DevvitRpcClient } from './devvitRpc.ts';

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

const validModmailId = (id: string): string => {
  const value = id.trim().replace(/^ModmailConversation_/u, '');
  if (!/^[A-Za-z0-9]+$/u.test(value)) throw new Error(`Invalid Reddit modmail conversation id ${id}`);
  return value;
};

export class RedditMutationClient {
  private readonly rpc: DevvitRpcClient;

  public constructor(
    cfg: RedditAuthCfg,
    options: RedditMutationOptions = {},
  ) {
    this.rpc = options.rpc ?? devvitRpcClient(cfg);
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
    _subreddit: string,
    _emoji: RedditEmoji,
    _input: RedditEmojiMedia,
  ): Promise<void> {
    throw new Error('Reddit Devvit 0.14.4 does not expose emoji asset upload through the Reddit client');
  }

  public async updateEmojiPermissions(_subreddit: string, _emoji: RedditEmoji): Promise<void> {
    throw new Error('Reddit Devvit 0.14.4 does not expose emoji permission management through the Reddit client');
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
    const value = await redditChain(this.rpc, [
      { kind: 'call', name: 'getSubredditByName', args: [subreddit] },
      { kind: 'call', name: 'getUserFlair', args: [{ usernames: [username] }] },
    ]);
    const raw = wireMap(value, 'Devvit user flair selection');
    const users = raw['users'];
    if (!Array.isArray(users) || users.length === 0) return { templateId: null, text: null };
    const selected = wireMap(users[0] ?? null, 'Devvit selected user flair');
    return {
      templateId: wireMaybeText(selected['flairTemplateId']) ?? wireMaybeText(selected['templateId']),
      text: wireMaybeText(selected['flairText']) ?? wireMaybeText(selected['text']),
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
    await redditCall(this.rpc, 'submitComment', [{ id: fullname, text: body }]);
  }

  public async markPrivateMessageRead(fullname: string): Promise<void> {
    if (!/^t4_[A-Za-z0-9]+$/u.test(fullname)) {
      throw new Error(`Invalid Reddit private-message fullname ${fullname}`);
    }
    await redditChain(this.rpc, [
      { kind: 'call', name: 'getMessages', args: [{ type: 'inbox', limit: 1000, pageSize: 100 }] },
      { kind: 'call', name: 'all', args: [] },
      { kind: 'find', name: 'id', equals: fullname },
      { kind: 'call', name: 'markAsRead', args: [] },
    ]);
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
