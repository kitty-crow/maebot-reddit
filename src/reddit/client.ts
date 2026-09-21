import type { RedditAuthCfg } from '../env.ts';
import { directMessages } from '../dm/decode.ts';
import type { RedditDirectMessage } from '../dm/types.ts';
import type { ModmailConversation, ModmailConversationPage } from '../modmail/types.ts';
import * as decode from './decode.ts';
import { redditEmojis, type RedditEmoji } from './emoji.ts';
import type { RedditRate } from './rate.ts';
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
import {
  bareId,
  devvitRpcClient,
  fullname,
  redditCall,
  redditChain,
  wireArray,
  wireBoolean,
  wireDateSeconds,
  wireMap,
  wireMaybeBoolean,
  wireMaybeNumber,
  wireMaybeText,
  wireNumber,
  wireText,
} from './devvitCompat.ts';
import { DevvitRpcClient, type DevvitWire } from './devvitRpc.ts';
import { legacyRedditApi, type LegacyRedditApi } from './legacyApi.ts';

export type RedditFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type RedditSleep = (ms: number) => Promise<void>;

export type RedditClientOptions = {
  readonly fetcher?: RedditFetch;
  readonly sleep?: RedditSleep;
  readonly random?: () => number;
  readonly maxAttempts?: number;
  readonly rateReserve?: number;
  readonly rpc?: DevvitRpcClient;
};

const emptyRate: RedditRate = { used: null, remaining: null, resetMs: null };

const mapArray = (value: DevvitWire, context: string): readonly { readonly [key: string]: DevvitWire }[] =>
  wireArray(value, context).map((item, index) => wireMap(item, `${context}[${index}]`));

const flairTemplate = (value: DevvitWire): RedditFlairTemplate => {
  const raw = wireMap(value, 'Devvit flair template');
  return {
    id: wireText(raw['id'], 'Devvit flair template id'),
    text: wireText(raw['text'], 'Devvit flair template text', ''),
    cssClass: wireMaybeText(raw['cssClass']),
    textColour: wireMaybeText(raw['textColor']),
    backgroundColour: wireMaybeText(raw['backgroundColor']),
    modOnly: wireBoolean(raw['modOnly'], 'Devvit flair template modOnly', false),
    textEditable: wireBoolean(raw['allowUserEdits'], 'Devvit flair template allowUserEdits', false),
    allowableContent: wireMaybeText(raw['allowableContent']),
    maxEmojis: wireMaybeNumber(raw['maxEmojis']),
  };
};

const devvitMediaUrls = (value: DevvitWire): readonly string[] => {
  const out = new Set<string>();
  const mediaPattern = /(?:i\.redd\.it|preview\.redd\.it|external-preview\.redd\.it|\.gif(?:v)?(?:$|[?#])|\.(?:avif|jpe?g|png|webp)(?:$|[?#]))/iu;
  const visit = (current: DevvitWire, depth: number): void => {
    if (depth > 8) return;
    if (typeof current === 'string') {
      if (mediaPattern.test(current)) out.add(current.replace(/&amp;/gu, '&'));
      return;
    }
    if (current === null || typeof current !== 'object') return;
    if (Array.isArray(current)) {
      for (const child of current) visit(child, depth + 1);
      return;
    }
    for (const child of Object.values(current)) visit(child, depth + 1);
  };
  visit(value, 0);
  return [...out].slice(0, 12);
};

const flairAssignment = (value: DevvitWire): RedditFlairAssignment => {
  const raw = wireMap(value, 'Devvit user flair');
  return {
    username: wireText(raw['user'], 'Devvit user flair username'),
    templateId: wireMaybeText(raw['flairTemplateId']) ?? wireMaybeText(raw['templateId']),
    text: wireMaybeText(raw['flairText']) ?? wireMaybeText(raw['text']),
    cssClass: wireMaybeText(raw['flairCssClass']) ?? wireMaybeText(raw['cssClass']),
  };
};

const post = (value: DevvitWire): RedditPost => {
  const raw = wireMap(value, 'Devvit post');
  const rawId = wireText(raw['id'], 'Devvit post id');
  const flair = raw['flair'] === undefined ? null : wireMap(raw['flair'], 'Devvit post flair');
  const mediaUrls = devvitMediaUrls(raw);
  return {
    id: bareId(rawId, 't3_'),
    fullname: fullname(rawId, 't3_'),
    subreddit: wireText(raw['subredditName'], 'Devvit post subreddit', ''),
    title: wireText(raw['title'], 'Devvit post title', ''),
    author: wireMaybeText(raw['authorName']),
    permalink: wireText(raw['permalink'], 'Devvit post permalink', ''),
    createdUtc: wireDateSeconds(raw['createdAt'], 'Devvit post createdAt'),
    selfText: wireText(raw['body'], 'Devvit post body', ''),
    url: wireText(raw['url'], 'Devvit post url', ''),
    flairTemplateId: flair === null ? null : wireMaybeText(flair['templateId']),
    flairText: flair === null ? null : wireMaybeText(flair['text']),
    stickied: wireBoolean(raw['stickied'], 'Devvit post stickied', false),
    locked: wireBoolean(raw['locked'], 'Devvit post locked', false),
    over18: wireBoolean(raw['nsfw'], 'Devvit post nsfw', false),
    crosspostParent: wireMaybeText(raw['crosspostParentId']),
    score: wireNumber(raw['score'], 'Devvit post score', 0),
    mediaUrls,
  };
};

const relationship = (value: DevvitWire): decode.RedditRelationshipUser => {
  const raw = wireMap(value, 'Devvit relationship user');
  return {
    username: wireText(raw['username'], 'Devvit relationship username'),
    note: wireMaybeText(raw['note']),
    date: raw['date'] === undefined && raw['createdAt'] === undefined
      ? null
      : wireDateSeconds(raw['date'] ?? raw['createdAt'], 'Devvit relationship date'),
  };
};

const modmailState = (value: string | null): ModmailConversation['state'] => {
  if (
    value === 'new'
    || value === 'inprogress'
    || value === 'archived'
    || value === 'appeals'
    || value === 'join_requests'
    || value === 'filtered'
  ) return value;
  return 'unknown';
};

const modmailConversationFrom = (value: DevvitWire): ModmailConversation => {
  const raw = wireMap(value, 'Devvit modmail conversation');
  const owner = raw['owner'] === undefined || raw['owner'] === null ? null : wireMap(raw['owner'], 'Devvit modmail owner');
  const participant = raw['participant'] === undefined || raw['participant'] === null
    ? owner
    : wireMap(raw['participant'], 'Devvit modmail participant');
  const messagesValue = raw['messages'];
  const messages = messagesValue === undefined
    ? []
    : (Array.isArray(messagesValue)
        ? messagesValue
        : Object.values(wireMap(messagesValue, 'Devvit modmail messages')))
      .map((entry, index) => {
        const message = wireMap(entry, `Devvit modmail message[${index}]`);
        const author = message['author'] === undefined || message['author'] === null
          ? null
          : wireMap(message['author'], 'Devvit modmail message author');
        return {
          id: wireText(message['id'], 'Devvit modmail message id'),
          conversationId: wireText(
            message['conversationId'],
            'Devvit modmail message conversation id',
            wireText(raw['id'], 'Devvit modmail conversation id'),
          ),
          author: author === null ? null : {
            id: wireMaybeText(author['id']),
            name: wireMaybeText(author['name']),
            isModerator: wireBoolean(author['isMod'] ?? author['isModerator'], 'Devvit modmail author moderator', false),
            isAdmin: wireBoolean(author['isAdmin'], 'Devvit modmail author admin', false),
            isParticipant: wireBoolean(author['isParticipant'], 'Devvit modmail author participant', false),
            isHidden: wireBoolean(author['isHidden'], 'Devvit modmail author hidden', false),
            isDeleted: wireBoolean(author['isDeleted'], 'Devvit modmail author deleted', false),
          },
          bodyMarkdown: wireText(message['bodyMarkdown'] ?? message['body'], 'Devvit modmail body', ''),
          createdAt: wireDateSeconds(message['date'] ?? message['createdAt'], 'Devvit modmail message date'),
          isInternal: wireBoolean(message['isInternal'], 'Devvit modmail message internal', false),
          participatingAs: wireMaybeText(message['participatingAs']),
        };
      });
  return {
    id: wireText(raw['id'], 'Devvit modmail conversation id'),
    subreddit: wireMaybeText(raw['subredditName'])
      ?? (raw['subreddit'] === undefined || raw['subreddit'] === null
        ? ''
        : wireText(wireMap(raw['subreddit'], 'Devvit modmail subreddit')['name'], 'Devvit modmail subreddit name', '')),
    subject: wireText(raw['subject'], 'Devvit modmail subject', ''),
    participant: participant === null ? null : {
      id: wireMaybeText(participant['id']),
      name: wireMaybeText(participant['name']),
      isModerator: wireBoolean(participant['isMod'] ?? participant['isModerator'], 'Devvit modmail participant moderator', false),
      isAdmin: wireBoolean(participant['isAdmin'], 'Devvit modmail participant admin', false),
      isParticipant: wireBoolean(participant['isParticipant'], 'Devvit modmail participant flag', true),
      isHidden: wireBoolean(participant['isHidden'], 'Devvit modmail participant hidden', false),
      isDeleted: wireBoolean(participant['isDeleted'], 'Devvit modmail participant deleted', false),
    },
    kind: 'unknown',
    state: modmailState(wireMaybeText(raw['state'])),
    isInternal: wireBoolean(raw['isInternal'], 'Devvit modmail internal', false),
    isAuto: wireBoolean(raw['isAuto'], 'Devvit modmail auto', false),
    lastUpdatedAt: wireDateSeconds(raw['lastUpdated'] ?? raw['lastUpdatedAt'], 'Devvit modmail updatedAt'),
    messages,
  };
};

export class RedditReadClient {
  private readonly rpc: DevvitRpcClient;
  private readonly legacy: LegacyRedditApi | null;

  public constructor(
    private readonly cfg: RedditAuthCfg,
    options: RedditClientOptions = {},
  ) {
    this.rpc = options.rpc ?? devvitRpcClient(cfg);
    this.legacy = legacyRedditApi(cfg, options.fetcher);
  }

  public rate(): RedditRate {
    return emptyRate;
  }

  public async me(): Promise<RedditAccount> {
    const raw = wireMap(await redditCall(this.rpc, 'getAppUser'), 'Devvit current user');
    return {
      id: bareId(wireText(raw['id'], 'Devvit current user id'), 't2_'),
      name: wireText(raw['username'], 'Devvit current username', this.cfg.username),
      createdUtc: raw['createdAt'] === undefined ? null : wireDateSeconds(raw['createdAt'], 'Devvit current user createdAt'),
      linkKarma: wireMaybeNumber(raw['linkKarma']),
      commentKarma: wireMaybeNumber(raw['commentKarma']),
    };
  }

  public async subreddit(name: string): Promise<RedditSubreddit> {
    const [info, moderators] = await Promise.all([
      redditCall(this.rpc, 'getSubredditInfoByName', [name]),
      this.moderators(name),
    ]);
    const raw = wireMap(info, 'Devvit subreddit info');
    const authorFlair = raw['authorFlairSettings'] === undefined || raw['authorFlairSettings'] === null
      ? null
      : wireMap(raw['authorFlairSettings'], 'Devvit author flair settings');
    const postFlair = raw['postFlairSettings'] === undefined || raw['postFlairSettings'] === null
      ? null
      : wireMap(raw['postFlairSettings'], 'Devvit post flair settings');
    return {
      id: bareId(wireText(raw['id'], 'Devvit subreddit id'), 't5_'),
      name: wireText(raw['name'], 'Devvit subreddit name', name),
      title: wireText(raw['title'], 'Devvit subreddit title', ''),
      subscribers: wireMaybeNumber(raw['subscribersCount']),
      userIsModerator: moderators.some(mod => mod.name.toLowerCase() === this.cfg.username.toLowerCase()),
      userFlairEnabled: authorFlair === null ? null : wireMaybeBoolean(authorFlair['isEnabled']),
      userFlairSelfAssign: authorFlair === null ? null : wireMaybeBoolean(authorFlair['isSelfAssignabled']),
      linkFlairEnabled: postFlair === null ? null : wireMaybeBoolean(postFlair['isEnabled']),
      over18: wireMaybeBoolean(raw['isNsfw']),
      submissionType: null,
    };
  }

  public async moderators(name: string): Promise<readonly RedditModerator[]> {
    const value = await redditChain(this.rpc, [
      { kind: 'call', name: 'getModerators', args: [{ subredditName: name, limit: 1000, pageSize: 100 }] },
      { kind: 'call', name: 'all', args: [] },
    ]);
    return mapArray(value, 'Devvit moderators').map(raw => {
      const permissionsRaw = raw['modPermissions'];
      const permissions = Array.isArray(raw['permissions'])
        ? raw['permissions'].filter((item): item is string => typeof item === 'string')
        : permissionsRaw !== undefined && typeof permissionsRaw === 'object' && permissionsRaw !== null && !Array.isArray(permissionsRaw)
          ? Object.values(permissionsRaw).flatMap(item =>
              Array.isArray(item) ? item.filter((child): child is string => typeof child === 'string') : [])
          : [];
      return {
        name: wireText(raw['username'], 'Devvit moderator username'),
        id: wireMaybeText(raw['id']),
        permissions,
      };
    });
  }

  public async bannedUsers(name: string): Promise<readonly decode.RedditRelationshipUser[]> {
    const value = await redditChain(this.rpc, [
      { kind: 'call', name: 'getBannedUsers', args: [{ subredditName: name, limit: 1000, pageSize: 100 }] },
      { kind: 'call', name: 'all', args: [] },
    ]);
    return wireArray(value, 'Devvit banned users').map(relationship);
  }

  public async bannedUser(name: string, username: string): Promise<decode.RedditRelationshipUser | null> {
    const users = await this.bannedUsers(name);
    return users.find(item => item.username.toLowerCase() === username.toLowerCase()) ?? null;
  }

  public async mutedUsers(name: string): Promise<readonly decode.RedditRelationshipUser[]> {
    const value = await redditChain(this.rpc, [
      { kind: 'call', name: 'getMutedUsers', args: [{ subredditName: name, limit: 1000, pageSize: 100 }] },
      { kind: 'call', name: 'all', args: [] },
    ]);
    return wireArray(value, 'Devvit muted users').map(relationship);
  }

  public async mutedUser(name: string, username: string): Promise<decode.RedditRelationshipUser | null> {
    const users = await this.mutedUsers(name);
    return users.find(item => item.username.toLowerCase() === username.toLowerCase()) ?? null;
  }

  public async emojis(name: string): Promise<readonly RedditEmoji[]> {
    if (this.legacy === null) {
      throw new Error('Reddit custom emoji inventory requires legacy Reddit OAuth fallback');
    }
    return redditEmojis(await this.legacy.get(`/api/v1/${encodeURIComponent(name)}/emojis/all`));
  }

  public async userFlairTemplates(name: string): Promise<readonly RedditFlairTemplate[]> {
    return wireArray(
      await redditCall(this.rpc, 'getUserFlairTemplates', [name]),
      'Devvit user flair templates',
    ).map(flairTemplate);
  }

  public async postFlairTemplates(name: string): Promise<readonly RedditFlairTemplate[]> {
    return wireArray(
      await redditCall(this.rpc, 'getPostFlairTemplates', [name]),
      'Devvit post flair templates',
    ).map(flairTemplate);
  }

  public async userFlairAssignments(name: string): Promise<readonly RedditFlairAssignment[]> {
    if (this.legacy === null) {
      throw new Error('Complete Reddit user-flair inventory requires legacy Reddit OAuth fallback');
    }
    const out: RedditFlairAssignment[] = [];
    let after: string | null = null;
    let count = 0;
    do {
      const query = new URLSearchParams({ limit: '1000', count: String(count) });
      if (after !== null) query.set('after', after);
      const page = decode.flairAssignments(await this.legacy.get(
        `/r/${encodeURIComponent(name)}/api/flairlist?${query.toString()}`,
      ));
      out.push(...page.assignments);
      count = out.length;
      after = page.next;
    } while (after !== null);
    return out;
  }

  public async userFlairAssignment(name: string, username: string): Promise<RedditFlairAssignment | null> {
    if (this.legacy === null) {
      throw new Error('Reddit user-flair lookup requires legacy Reddit OAuth fallback');
    }
    const query = new URLSearchParams({ limit: '1', name: username });
    const page = decode.flairAssignments(await this.legacy.get(
      `/r/${encodeURIComponent(name)}/api/flairlist?${query.toString()}`,
    ));
    return page.assignments.find(item => item.username.toLowerCase() === username.toLowerCase()) ?? null;
  }

  public async rules(name: string): Promise<decode.RulesPayload> {
    if (this.legacy === null) {
      throw new Error('Complete Reddit rule inventory requires legacy Reddit OAuth fallback');
    }
    return decode.rules(await this.legacy.get(
      `/r/${encodeURIComponent(name)}/about/rules`,
    ));
  }

  public async sticky(name: string, slot: 1 | 2): Promise<RedditPost | null> {
    const posts = await this.hotPosts(name, 10);
    return posts.filter(item => item.stickied)[slot - 1] ?? null;
  }

  public async hotPosts(name: string, limit = 100): Promise<readonly RedditPost[]> {
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    const value = await redditChain(this.rpc, [
      { kind: 'call', name: 'getHotPosts', args: [{ subredditName: name, limit: safeLimit, pageSize: Math.min(100, safeLimit) }] },
      { kind: 'call', name: 'all', args: [] },
    ]);
    return wireArray(value, 'Devvit hot posts').map(post);
  }

  public async newPosts(name: string, limit = 25): Promise<readonly RedditPost[]> {
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    const value = await redditChain(this.rpc, [
      { kind: 'call', name: 'getNewPosts', args: [{ subredditName: name, limit: safeLimit, pageSize: Math.min(100, safeLimit) }] },
      { kind: 'call', name: 'all', args: [] },
    ]);
    return wireArray(value, 'Devvit new posts').map(post);
  }

  public async newComments(name: string, limit = 25): Promise<readonly RedditComment[]> {
    if (this.legacy === null) {
      throw new Error('Subreddit comment listings require legacy Reddit OAuth fallback');
    }
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    return decode.comments(await this.legacy.get(
      `/r/${encodeURIComponent(name)}/comments?limit=${safeLimit}`,
    )).items;
  }

  public async newPostsHistory(name: string, maxItems = 1000): Promise<readonly RedditPost[]> {
    return await this.newPosts(name, Math.max(1, Math.min(1000, Math.floor(maxItems))));
  }

  public async newCommentsHistory(name: string, maxItems = 1000): Promise<readonly RedditComment[]> {
    if (this.legacy === null) {
      throw new Error('Subreddit comment history requires legacy Reddit OAuth fallback');
    }
    const max = Math.max(1, Math.min(1000, Math.floor(maxItems)));
    const out: RedditComment[] = [];
    let after: string | null = null;
    while (out.length < max) {
      const limit = Math.min(100, max - out.length);
      const query = new URLSearchParams({ limit: String(limit), count: String(out.length) });
      if (after !== null) query.set('after', after);
      const page = decode.comments(await this.legacy.get(
        `/r/${encodeURIComponent(name)}/comments?${query.toString()}`,
      ));
      out.push(...page.items.slice(0, max - out.length));
      if (page.after === null || page.items.length === 0) break;
      after = page.after;
    }
    return out;
  }

  private async legacyDirectMessages(
    path: '/message/inbox' | '/message/unread' | '/message/sent',
    context: string,
    maxItems: number,
  ): Promise<readonly RedditDirectMessage[]> {
    if (this.legacy === null) {
      throw new Error('Reddit direct-message listings require legacy Reddit OAuth fallback');
    }
    const max = Math.max(1, Math.min(1000, Math.floor(maxItems)));
    const out: RedditDirectMessage[] = [];
    let after: string | null = null;
    while (out.length < max) {
      const limit = Math.min(100, max - out.length);
      const query = new URLSearchParams({ limit: String(limit), count: String(out.length) });
      if (after !== null) query.set('after', after);
      const page = directMessages(
        await this.legacy.get(`${path}?${query.toString()}`),
        context,
      );
      out.push(...page.messages.slice(0, max - out.length));
      if (page.after === null || page.messages.length === 0) break;
      after = page.after;
    }
    return out;
  }

  public async inboxDirectMessages(maxItems = 1000): Promise<readonly RedditDirectMessage[]> {
    return await this.legacyDirectMessages('/message/inbox', 'private message inbox', maxItems);
  }

  public async unreadDirectMessages(maxItems = 1000): Promise<readonly RedditDirectMessage[]> {
    return await this.legacyDirectMessages('/message/unread', 'unread private messages', maxItems);
  }

  public async sentDirectMessages(maxItems = 1000): Promise<readonly RedditDirectMessage[]> {
    return await this.legacyDirectMessages('/message/sent', 'sent private messages', maxItems);
  }

  public async modmailConversations(name: string, limit = 100): Promise<ModmailConversationPage> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const value = await redditChain(this.rpc, [
      { kind: 'get', name: 'modMail' },
      { kind: 'call', name: 'getConversations', args: [{ subreddits: [name], limit: safeLimit, sort: 'recent', state: 'all' }] },
    ]);
    const raw = wireMap(value, 'Devvit modmail conversations');
    const conversationsRaw = raw['conversations'];
    const conversations = conversationsRaw === undefined || conversationsRaw === null
      ? []
      : Object.values(wireMap(conversationsRaw, 'Devvit modmail conversation map')).map(modmailConversationFrom);
    return {
      conversations,
      after: wireMaybeText(raw['next']) ?? wireMaybeText(raw['after']),
    };
  }

  public async modmailConversation(id: string, markRead = false): Promise<ModmailConversation> {
    const value = await redditChain(this.rpc, [
      { kind: 'get', name: 'modMail' },
      { kind: 'call', name: 'getConversation', args: [{ conversationId: id, markRead }] },
    ]);
    const raw = wireMap(value, 'Devvit modmail conversation response');
    const conversationValue = raw['conversation'] ?? raw;
    const conversationRaw = wireMap(conversationValue, 'Devvit modmail conversation');
    const merged: { [key: string]: DevvitWire } = { ...conversationRaw };
    if (raw['messages'] !== undefined) merged['messages'] = raw['messages'];
    return modmailConversationFrom(merged);
  }

  public async scores(fullnames: readonly string[]): Promise<readonly RedditThingScore[]> {
    const values = [...new Set(fullnames.map(value => value.trim()))];
    if (values.length > 100) throw new Error('Reddit score inventory reads are limited to 100 fullnames per request');
    return await Promise.all(values.map(async value => {
      const kind = value.startsWith('t1_') ? 'comment' : value.startsWith('t3_') ? 'post' : null;
      if (kind === null) throw new Error(`Invalid Reddit fullname ${value}`);
      const raw = wireMap(
        await redditCall(this.rpc, kind === 'post' ? 'getPostById' : 'getCommentById', [value]),
        `Devvit ${kind}`,
      );
      return {
        fullname: value,
        score: wireNumber(raw['score'], `Devvit ${kind} score`, 0),
        archived: wireBoolean(raw['archived'], `Devvit ${kind} archived`, false),
      };
    }));
  }
}
