import {
  executeAdapterCommand,
  type AdapterCommand,
  type AdapterRoots,
  type AdapterStep,
  type Wire,
} from './controller.ts';

export type LegacyCompatRequest = {
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly form?: Readonly<Record<string, string>>;
};

export type LegacyCompatResponse =
  | { readonly supported: false }
  | { readonly supported: true; readonly status: number; readonly body: Wire };

type WireMap = { readonly [key: string]: Wire };

let nextId = 0;

const map = (value: Wire, context: string): WireMap => {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${context} was not an object`);
  }
  return value;
};

const array = (value: Wire, context: string): readonly Wire[] => {
  if (!Array.isArray(value)) throw new Error(`${context} was not an array`);
  return value;
};

const text = (value: Wire | undefined, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const maybeText = (value: Wire | undefined): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const number = (value: Wire | undefined, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const bool = (value: Wire | undefined, fallback = false): boolean =>
  typeof value === 'boolean' ? value : fallback;

const bare = (value: string, prefix: string): string =>
  value.startsWith(prefix) ? value.slice(prefix.length) : value;

const fullname = (value: string, prefix: string): string =>
  value.startsWith(prefix) ? value : `${prefix}${value}`;

const dateSeconds = (value: Wire | undefined): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value / 1_000) : Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1_000) : 0;
  }
  if (value !== null && value !== undefined && !Array.isArray(value) && typeof value === 'object') {
    const raw = value['$date'];
    if (typeof raw === 'string') {
      const parsed = Date.parse(raw);
      return Number.isFinite(parsed) ? Math.floor(parsed / 1_000) : 0;
    }
  }
  return 0;
};

const run = async (
  roots: AdapterRoots,
  root: 'reddit' | 'media',
  steps: readonly AdapterStep[],
): Promise<Wire> => {
  nextId += 1;
  const command: AdapterCommand = {
    id: `compat:${nextId}`,
    root,
    steps,
  };
  return await executeAdapterCommand(command, roots);
};

const redditCall = async (
  roots: AdapterRoots,
  name: string,
  args: readonly Wire[] = [],
): Promise<Wire> => await run(roots, 'reddit', [{ kind: 'call', name, args }]);

const redditList = async (
  roots: AdapterRoots,
  name: string,
  args: readonly Wire[],
): Promise<readonly Wire[]> =>
  array(await run(roots, 'reddit', [
    { kind: 'call', name, args },
    { kind: 'call', name: 'all', args: [] },
  ]), name);

const listing = (
  children: readonly Wire[],
  kind: 't1' | 't2' | 't3' | 't4' | 't5' | '',
  after: string | null = null,
): Wire => ({
  kind: 'Listing',
  data: {
    after,
    before: null,
    children: children.map(data => kind.length === 0 ? data : { kind, data }),
  },
});

const cursorFrom = (
  values: readonly Wire[],
  requested: number,
  prefix: 't2_' | 't3_',
): string | null => {
  if (values.length < requested) return null;
  const last = values.at(-1);
  if (last === undefined) return null;
  const raw = map(last, 'Devvit listing cursor item');
  const id = maybeText(raw['id']);
  return id === null ? null : fullname(id, prefix);
};

const appUserData = (value: Wire): Wire => {
  const raw = map(value, 'Devvit app user');
  const id = text(raw['id']);
  return {
    id: bare(id, 't2_'),
    name: text(raw['username']),
    created_utc: dateSeconds(raw['createdAt']),
    link_karma: number(raw['linkKarma']),
    comment_karma: number(raw['commentKarma']),
  };
};

const moderatorData = (value: Wire): Wire => {
  const raw = map(value, 'Devvit moderator');
  const moderatorInfo = raw['moderatorInfo'] === undefined || raw['moderatorInfo'] === null
    ? null
    : map(raw['moderatorInfo'], 'Devvit moderator info');
  const directPermissions = moderatorInfo?.['modPermissions'];
  const accountPermissions = raw['modPermissions'];
  let decoded: readonly Wire[] = [];
  if (Array.isArray(directPermissions)) {
    decoded = directPermissions.filter(item => typeof item === 'string');
  } else if (
    accountPermissions !== null
    && accountPermissions !== undefined
    && !Array.isArray(accountPermissions)
    && typeof accountPermissions === 'object'
  ) {
    decoded = Object.values(accountPermissions).flatMap(item =>
      Array.isArray(item) ? item.filter(child => typeof child === 'string') : []);
  }
  return {
    name: text(raw['username'] ?? raw['name']),
    id: maybeText(raw['id']),
    mod_permissions: decoded,
  };
};

const relationshipData = (value: Wire): Wire => {
  const raw = map(value, 'Devvit relationship');
  return {
    name: text(raw['username'] ?? raw['name']),
    note: maybeText(raw['note']),
    date: raw['date'] === undefined && raw['createdAt'] === undefined
      ? null
      : dateSeconds(raw['date'] ?? raw['createdAt']),
  };
};

const flairData = (value: Wire): Wire => {
  const raw = map(value, 'Devvit flair');
  return {
    id: text(raw['id']),
    text: text(raw['text']),
    css_class: maybeText(raw['cssClass']),
    text_color: maybeText(raw['textColor']),
    background_color: maybeText(raw['backgroundColor']),
    mod_only: bool(raw['modOnly']),
    text_editable: bool(raw['allowUserEdits']),
    allowable_content: maybeText(raw['allowableContent']),
    max_emojis: raw['maxEmojis'] === undefined ? null : number(raw['maxEmojis']),
  };
};

const ruleData = (value: Wire): Wire => {
  const raw = map(value, 'Devvit rule');
  return {
    short_name: text(raw['shortName']),
    description: text(raw['description']),
    violation_reason: maybeText(raw['violationReason']),
    kind: maybeText(raw['kind']),
    priority: raw['priority'] === undefined ? null : number(raw['priority']),
  };
};

const postData = (value: Wire): Wire => {
  const raw = map(value, 'Devvit post');
  const rawId = text(raw['id']);
  const flair = raw['flair'] === undefined || raw['flair'] === null
    ? null
    : map(raw['flair'], 'Devvit post flair');
  return {
    id: bare(rawId, 't3_'),
    name: fullname(rawId, 't3_'),
    subreddit: text(raw['subredditName']),
    title: text(raw['title']),
    author: maybeText(raw['authorName']) ?? '[deleted]',
    permalink: text(raw['permalink']),
    created_utc: dateSeconds(raw['createdAt']),
    selftext: text(raw['body']),
    url: text(raw['url']),
    link_flair_template_id: flair === null ? null : maybeText(flair['templateId']),
    link_flair_text: flair === null ? null : maybeText(flair['text']),
    stickied: bool(raw['stickied']),
    locked: bool(raw['locked']),
    over_18: bool(raw['nsfw']),
    crosspost_parent: maybeText(raw['crosspostParentId']),
    score: Math.floor(number(raw['score'])),
  };
};

const commentData = (value: Wire): Wire => {
  const raw = map(value, 'Devvit comment');
  const rawId = text(raw['id']);
  return {
    id: bare(rawId, 't1_'),
    name: fullname(rawId, 't1_'),
    subreddit: text(raw['subredditName']),
    link_id: fullname(text(raw['postId'] ?? raw['linkId']), 't3_'),
    parent_id: maybeText(raw['parentId']),
    link_title: maybeText(raw['postTitle'] ?? raw['linkTitle']),
    link_author: maybeText(raw['postAuthorName'] ?? raw['linkAuthor']),
    link_permalink: maybeText(raw['postPermalink'] ?? raw['linkPermalink']),
    link_flair_text: maybeText(raw['postFlairText'] ?? raw['linkFlairText']),
    author: maybeText(raw['authorName']) ?? '[deleted]',
    body: text(raw['body']),
    permalink: text(raw['permalink']),
    created_utc: dateSeconds(raw['createdAt']),
    distinguished: maybeText(raw['distinguishedBy']),
    stickied: bool(raw['stickied']),
    removed_by_category: null,
    score: Math.floor(number(raw['score'])),
  };
};

const subredditBody = async (name: string, roots: AdapterRoots): Promise<Wire> => {
  const [infoValue, meValue, moderators] = await Promise.all([
    redditCall(roots, 'getSubredditInfoByName', [name]),
    redditCall(roots, 'getAppUser'),
    redditList(roots, 'getModerators', [{ subredditName: name, limit: 1000, pageSize: 100 }]),
  ]);
  const info = map(infoValue, 'Devvit subreddit');
  const me = map(meValue, 'Devvit app user');
  const username = text(me['username']).toLowerCase();
  const authorFlair = info['authorFlairSettings'] === undefined || info['authorFlairSettings'] === null
    ? null
    : map(info['authorFlairSettings'], 'Devvit author flair settings');
  const postFlair = info['postFlairSettings'] === undefined || info['postFlairSettings'] === null
    ? null
    : map(info['postFlairSettings'], 'Devvit post flair settings');
  const rawId = text(info['id']);
  return {
    kind: 't5',
    data: {
      id: bare(rawId, 't5_'),
      name: fullname(rawId, 't5_'),
      display_name: text(info['name'], name),
      title: text(info['title']),
      subscribers: info['subscribersCount'] === undefined ? null : number(info['subscribersCount']),
      user_is_moderator: moderators.some(value => {
        const row = map(value, 'Devvit moderator');
        return text(row['username'] ?? row['name']).toLowerCase() === username;
      }),
      user_flair_enabled_in_sr: authorFlair === null ? null : bool(authorFlair['isEnabled']),
      user_flair_self_assign_enabled: authorFlair === null ? null : bool(authorFlair['isSelfAssignabled']),
      link_flair_enabled: postFlair === null ? null : bool(postFlair['isEnabled']),
      over18: info['isNsfw'] === undefined ? null : bool(info['isNsfw']),
      submission_type: null,
    },
  };
};

const rulesBody = async (name: string, roots: AdapterRoots): Promise<Wire> => ({
  rules: array(await redditCall(roots, 'getRules', [name]), 'Devvit rules').map(ruleData),
  site_rules: [],
});

const postListing = async (
  roots: AdapterRoots,
  method: 'getHotPosts' | 'getNewPosts',
  name: string,
  limit: number,
  after: string | null,
): Promise<Wire> => {
  const options: Record<string, Wire> = {
    subredditName: name,
    limit,
    pageSize: Math.min(100, limit),
  };
  if (after !== null) options['after'] = after;
  const values = await redditList(roots, method, [options]);
  return listing(values.map(postData), 't3', cursorFrom(values, limit, 't3_'));
};

const infoListing = async (roots: AdapterRoots, ids: readonly string[]): Promise<Wire> => {
  const children: Wire[] = [];
  for (const id of ids) {
    if (id.startsWith('t3_')) {
      children.push({ kind: 't3', data: postData(await redditCall(roots, 'getPostById', [id])) });
    } else if (id.startsWith('t1_')) {
      children.push({ kind: 't1', data: commentData(await redditCall(roots, 'getCommentById', [id])) });
    }
  }
  return {
    kind: 'Listing',
    data: { after: null, before: null, children },
  };
};

const positiveLimit = (raw: string | undefined, fallback: number, max: number): number => {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) return fallback;
  return Math.min(max, value);
};


const isoDate = (value: Wire | undefined): string => {
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : '';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 10_000_000_000 ? value : value * 1_000;
    return new Date(millis).toISOString();
  }
  if (value !== null && value !== undefined && !Array.isArray(value) && typeof value === 'object') {
    const raw = value['$date'];
    if (typeof raw === 'string') {
      const parsed = new Date(raw);
      return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : '';
    }
  }
  return '';
};

const participantData = (value: Wire | undefined): Wire => {
  if (value === undefined || value === null) return null;
  const raw = map(value, 'Devvit Modmail participant');
  return {
    id: maybeText(raw['id']),
    name: maybeText(raw['name'] ?? raw['username']),
    isMod: bool(raw['isMod'] ?? raw['isModerator']),
    isAdmin: bool(raw['isAdmin']),
    isParticipant: bool(raw['isParticipant']),
    isHidden: bool(raw['isHidden']),
    isDeleted: bool(raw['isDeleted']),
  };
};

const conversationKind = (value: Wire | undefined): string => {
  const raw = maybeText(value)?.toLowerCase() ?? '';
  if (raw === 'sr_user' || raw === 'sr_sr' || raw === 'internal') return raw;
  if (raw === 'sruser') return 'sr_user';
  if (raw === 'srsr') return 'sr_sr';
  return 'unknown';
};

const modmailMessageData = (value: Wire, conversationId: string): Wire => {
  const raw = map(value, 'Devvit Modmail message');
  return {
    id: text(raw['id']),
    conversationId: text(raw['conversationId'], conversationId),
    author: participantData(raw['author']),
    bodyMarkdown: text(raw['bodyMarkdown'] ?? raw['body']),
    date: isoDate(raw['date'] ?? raw['createdAt']),
    isInternal: bool(raw['isInternal']),
    participatingAs: maybeText(raw['participatingAs']),
  };
};

const modmailConversationData = (value: Wire): Wire => {
  const raw = map(value, 'Devvit Modmail conversation');
  const id = text(raw['id']);
  const rawMessages = raw['messages'];
  const values = rawMessages === undefined || rawMessages === null
    ? []
    : Array.isArray(rawMessages)
      ? rawMessages
      : Object.values(map(rawMessages, 'Devvit Modmail messages'));
  const messages = Object.fromEntries(values.map(message => {
    const converted = map(modmailMessageData(message, id), 'converted Modmail message');
    return [text(converted['id']), converted];
  }));
  const subredditRaw = raw['subreddit'];
  const subredditName = maybeText(raw['subredditName'])
    ?? (subredditRaw === undefined || subredditRaw === null
      ? null
      : maybeText(
          map(subredditRaw, 'Devvit Modmail subreddit')['displayName']
          ?? map(subredditRaw, 'Devvit Modmail subreddit')['name'],
        ));
  return {
    id,
    subreddit: subredditName === null ? null : { displayName: subredditName, name: subredditName },
    owner: raw['owner'] === undefined ? null : participantData(raw['owner']),
    participant: raw['participant'] === undefined
      ? participantData(raw['owner'])
      : participantData(raw['participant']),
    subject: text(raw['subject']),
    conversationType: conversationKind(raw['conversationType'] ?? raw['kind']),
    state: maybeText(raw['state']) ?? 'unknown',
    isInternal: bool(raw['isInternal']),
    isAuto: bool(raw['isAuto']),
    lastUpdated: isoDate(raw['lastUpdated'] ?? raw['lastUpdatedAt']),
    messages,
    objIds: Object.keys(messages).map(messageId => ({ key: 'messages', id: messageId })),
  };
};

const modmailListBody = async (
  roots: AdapterRoots,
  subreddit: string,
  limit: number,
): Promise<Wire> => {
  const value = await run(roots, 'reddit', [
    { kind: 'get', name: 'modMail' },
    {
      kind: 'call',
      name: 'getConversations',
      args: [{ subreddits: [subreddit], limit, sort: 'recent', state: 'all' }],
    },
  ]);
  const raw = map(value, 'Devvit Modmail conversations');
  const conversationsRaw = raw['conversations'];
  const conversations = conversationsRaw === undefined || conversationsRaw === null
    ? []
    : Object.values(map(conversationsRaw, 'Devvit Modmail conversation map'));
  const converted = conversations.map(modmailConversationData);
  return {
    conversations: Object.fromEntries(converted.map(value => {
      const row = map(value, 'converted Modmail conversation');
      return [text(row['id']), row];
    })),
    messages: {},
    after: null,
  };
};

const modmailSingleBody = async (
  roots: AdapterRoots,
  id: string,
  markRead: boolean,
): Promise<Wire> => {
  const value = await run(roots, 'reddit', [
    { kind: 'get', name: 'modMail' },
    { kind: 'call', name: 'getConversation', args: [{ conversationId: id, markRead }] },
  ]);
  const raw = map(value, 'Devvit Modmail conversation response');
  return { conversation: modmailConversationData(raw['conversation'] ?? value) };
};

export const handleLegacyRead = async (
  request: LegacyCompatRequest,
  roots: AdapterRoots,
): Promise<LegacyCompatResponse> => {
  if (request.method !== 'GET') return { supported: false };
  const query = request.query ?? {};

  if (request.path === '/api/v1/me') {
    return { supported: true, status: 200, body: appUserData(await redditCall(roots, 'getAppUser')) };
  }

  const subredditAbout = /^\/r\/([^/]+)\/about$/u.exec(request.path);
  if (subredditAbout !== null) {
    return {
      supported: true,
      status: 200,
      body: await subredditBody(decodeURIComponent(subredditAbout[1] ?? ''), roots),
    };
  }

  const relation = /^\/r\/([^/]+)\/about\/(moderators|banned|muted)$/u.exec(request.path);
  if (relation !== null) {
    const name = decodeURIComponent(relation[1] ?? '');
    const kind = relation[2];
    const method = kind === 'moderators'
      ? 'getModerators'
      : kind === 'banned'
        ? 'getBannedUsers'
        : 'getMutedUsers';
    const limit = positiveLimit(query['limit'], 100, 1000);
    const options: Record<string, Wire> = {
      subredditName: name,
      limit,
      pageSize: Math.min(100, limit),
    };
    if (query['after'] !== undefined) options['after'] = query['after'];
    if ((kind === 'banned' || kind === 'muted') && query['user'] !== undefined) {
      options['username'] = query['user'];
    }
    const values = await redditList(roots, method, [options]);
    return {
      supported: true,
      status: 200,
      body: listing(
        values.map(kind === 'moderators' ? moderatorData : relationshipData),
        '',
        cursorFrom(values, limit, 't2_'),
      ),
    };
  }

  const rules = /^\/r\/([^/]+)\/about\/rules$/u.exec(request.path);
  if (rules !== null) {
    return {
      supported: true,
      status: 200,
      body: await rulesBody(decodeURIComponent(rules[1] ?? ''), roots),
    };
  }

  const posts = /^\/r\/([^/]+)\/(hot|new)$/u.exec(request.path);
  if (posts !== null) {
    const name = decodeURIComponent(posts[1] ?? '');
    const limit = positiveLimit(query['limit'], posts[2] === 'hot' ? 100 : 25, 1000);
    return {
      supported: true,
      status: 200,
      body: await postListing(
        roots,
        posts[2] === 'hot' ? 'getHotPosts' : 'getNewPosts',
        name,
        limit,
        query['after'] ?? null,
      ),
    };
  }

  if (request.path === '/api/info') {
    const ids = (query['id'] ?? '').split(',').map(value => value.trim()).filter(Boolean);
    if (ids.length === 0 || ids.length > 100) return { supported: false };
    return { supported: true, status: 200, body: await infoListing(roots, ids) };
  }

  if (request.path === '/api/mod/conversations') {
    const subreddit = query['entity'];
    if (subreddit === undefined || subreddit.length === 0) return { supported: false };
    return {
      supported: true,
      status: 200,
      body: await modmailListBody(roots, subreddit, positiveLimit(query['limit'], 25, 100)),
    };
  }

  const modmail = /^\/api\/mod\/conversations\/([A-Za-z0-9]+)$/u.exec(request.path);
  if (modmail !== null) {
    return {
      supported: true,
      status: 200,
      body: await modmailSingleBody(roots, modmail[1] ?? '', query['markRead'] === 'true'),
    };
  }

  return { supported: false };
};
