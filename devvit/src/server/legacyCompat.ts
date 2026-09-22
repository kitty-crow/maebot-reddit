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
): Wire => ({
  kind: 'Listing',
  data: {
    after: null,
    before: null,
    children: children.map(data => kind.length === 0 ? data : { kind, data }),
  },
});

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
  const permissions = raw['permissions'];
  const modPermissions = raw['modPermissions'];
  let decoded: readonly Wire[] = [];
  if (Array.isArray(permissions)) decoded = permissions.filter(item => typeof item === 'string');
  else if (modPermissions !== null && modPermissions !== undefined && !Array.isArray(modPermissions) && typeof modPermissions === 'object') {
    decoded = Object.values(modPermissions).flatMap(item =>
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
    distinguished: maybeText(raw['distinguished']),
    stickied: bool(raw['stickied']),
    removed_by_category: maybeText(raw['removedByCategory']),
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
      subscribers: info['subscribers'] === undefined ? null : number(info['subscribers']),
      user_is_moderator: moderators.some(value => {
        const row = map(value, 'Devvit moderator');
        return text(row['username'] ?? row['name']).toLowerCase() === username;
      }),
      user_flair_enabled_in_sr: authorFlair === null ? null : bool(authorFlair['enabled']),
      user_flair_self_assign_enabled: authorFlair === null ? null : bool(authorFlair['usersCanAssign']),
      link_flair_enabled: postFlair === null ? null : bool(postFlair['enabled']),
      over18: bool(info['nsfw']),
      submission_type: maybeText(info['type'] ?? info['submissionType']),
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
): Promise<Wire> =>
  listing(
    (await redditList(roots, method, [{
      subredditName: name,
      limit,
      pageSize: Math.min(100, limit),
    }])).map(postData),
    't3',
  );

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
    const values = await redditList(roots, method, [{
      subredditName: name,
      limit: positiveLimit(query['limit'], 100, 1000),
      pageSize: 100,
    }]);
    return {
      supported: true,
      status: 200,
      body: listing(values.map(kind === 'moderators' ? moderatorData : relationshipData), ''),
    };
  }

  const flair = /^\/r\/([^/]+)\/api\/(user_flair_v2|link_flair_v2)$/u.exec(request.path);
  if (flair !== null) {
    const name = decodeURIComponent(flair[1] ?? '');
    const method = flair[2] === 'user_flair_v2' ? 'getUserFlairTemplates' : 'getPostFlairTemplates';
    const values = array(await redditCall(roots, method, [name]), 'Devvit flair templates');
    return { supported: true, status: 200, body: values.map(flairData) };
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
      body: await postListing(roots, posts[2] === 'hot' ? 'getHotPosts' : 'getNewPosts', name, limit),
    };
  }

  if (request.path === '/api/info') {
    const ids = (query['id'] ?? '').split(',').map(value => value.trim()).filter(Boolean);
    if (ids.length === 0 || ids.length > 100) return { supported: false };
    return { supported: true, status: 200, body: await infoListing(roots, ids) };
  }

  return { supported: false };
};


const formText = (
  form: Readonly<Record<string, string>>,
  name: string,
  fallback = '',
): string => form[name] ?? fallback;

const createdPostBody = (value: Wire): Wire => {
  const raw = map(value, 'Devvit created post');
  const rawId = text(raw['id']);
  const id = bare(rawId, 't3_');
  return {
    json: {
      errors: [],
      data: {
        id,
        name: fullname(rawId, 't3_'),
        url: text(raw['url']),
      },
    },
  };
};

const successBody = (): Wire => ({ json: { errors: [] } });

const subredditFromPath = (path: string, suffix: string): string | null => {
  const pattern = new RegExp(`^/r/([^/]+)${suffix.replace(/[.*+?^$\{\}()|[\]\\]/gu, '\\$&')}$`, 'u');
  const match = pattern.exec(path);
  return match === null ? null : decodeURIComponent(match[1] ?? '');
};

const modmailId = (path: string, suffix = ''): string | null => {
  const escaped = suffix.replace(/[.*+?^$\{\}()|[\]\\]/gu, '\\$&');
  const match = new RegExp(`^/api/mod/conversations/([A-Za-z0-9]+)${escaped}$`, 'u').exec(path);
  return match?.[1] ?? null;
};

export const handleLegacyMutation = async (
  request: LegacyCompatRequest,
  roots: AdapterRoots,
): Promise<LegacyCompatResponse> => {
  if (request.method !== 'POST') return { supported: false };
  const form = request.form ?? {};

  if (request.path === '/api/submit') {
    const subreddit = formText(form, 'sr');
    const title = formText(form, 'title');
    const kind = formText(form, 'kind');
    const flairId = formText(form, 'flair_id');
    if (subreddit.length === 0 || title.length === 0) return { supported: false };

    if (kind === 'self') {
      const options: Record<string, Wire> = {
        subredditName: subreddit,
        title,
        text: formText(form, 'text'),
        sendreplies: formText(form, 'sendreplies', 'true') !== 'false',
      };
      if (flairId.length > 0) options['flairId'] = flairId;
      return {
        supported: true,
        status: 200,
        body: createdPostBody(await redditCall(roots, 'submitPost', [options])),
      };
    }

    if (kind === 'crosspost') {
      const source = formText(form, 'crosspost_fullname');
      if (!/^t3_[A-Za-z0-9]+$/u.test(source)) return { supported: false };
      const options: Record<string, Wire> = {
        subredditName: subreddit,
        postId: source,
        title,
        sendreplies: formText(form, 'sendreplies', 'true') !== 'false',
      };
      if (flairId.length > 0) options['flairId'] = flairId;
      return {
        supported: true,
        status: 200,
        body: createdPostBody(await redditCall(roots, 'crosspost', [options])),
      };
    }

    // Image/video/gallery submission has separate compatibility handling and
    // falls back to OAuth unless exact Devvit parity is established.
    return { supported: false };
  }

  const flairTemplateSubreddit = subredditFromPath(request.path, '/api/flairtemplate_v2');
  if (flairTemplateSubreddit !== null) {
    const type = formText(form, 'flair_type');
    const method = type === 'USER_FLAIR'
      ? 'createUserFlairTemplate'
      : type === 'LINK_FLAIR'
        ? 'createPostFlairTemplate'
        : null;
    if (method === null) return { supported: false };
    const options: Record<string, Wire> = {
      subredditName: flairTemplateSubreddit,
      text: formText(form, 'text'),
      modOnly: formText(form, 'mod_only') === 'true',
      allowUserEdits: formText(form, 'text_editable') === 'true',
    };
    const background = formText(form, 'background_color');
    const textColor = formText(form, 'text_color');
    const allowable = formText(form, 'allowable_content');
    const maxEmojis = Number(formText(form, 'max_emojis'));
    if (background.length > 0) options['backgroundColor'] = background;
    if (textColor === 'light' || textColor === 'dark') options['textColor'] = textColor;
    if (allowable === 'all' || allowable === 'emoji' || allowable === 'text') {
      options['allowableContent'] = allowable;
    }
    if (Number.isSafeInteger(maxEmojis) && maxEmojis >= 1 && maxEmojis <= 10) {
      options['maxEmojis'] = maxEmojis;
    }
    await redditCall(roots, method, [options]);
    return { supported: true, status: 200, body: successBody() };
  }

  const selectFlairSubreddit = subredditFromPath(request.path, '/api/selectflair');
  if (selectFlairSubreddit !== null) {
    const templateId = formText(form, 'flair_template_id');
    if (templateId.length === 0) return { supported: false };
    const customText = formText(form, 'text');
    const username = formText(form, 'name');
    const postId = formText(form, 'link');

    if (username.length > 0) {
      const options: Record<string, Wire> = {
        subredditName: selectFlairSubreddit,
        username,
        flairTemplateId: templateId,
      };
      if (customText.length > 0) options['text'] = customText;
      await redditCall(roots, 'setUserFlair', [options]);
      return { supported: true, status: 200, body: successBody() };
    }

    if (/^t3_[A-Za-z0-9]+$/u.test(postId)) {
      const options: Record<string, Wire> = {
        subredditName: selectFlairSubreddit,
        postId,
        flairTemplateId: templateId,
      };
      if (customText.length > 0) options['text'] = customText;
      await redditCall(roots, 'setPostFlair', [options]);
      return { supported: true, status: 200, body: successBody() };
    }

    return { supported: false };
  }

  const directFlairSubreddit = subredditFromPath(request.path, '/api/flair');
  if (directFlairSubreddit !== null) {
    const username = formText(form, 'name');
    if (username.length === 0) return { supported: false };
    await redditCall(roots, 'setUserFlair', [{
      subredditName: directFlairSubreddit,
      username,
      text: formText(form, 'text'),
      cssClass: formText(form, 'css_class'),
    }]);
    return { supported: true, status: 200, body: successBody() };
  }

  if (request.path === '/api/remove') {
    const id = formText(form, 'id');
    if (!/^(?:t1|t3)_[A-Za-z0-9]+$/u.test(id)) return { supported: false };
    await redditCall(roots, 'remove', [id, false]);
    return { supported: true, status: 200, body: successBody() };
  }

  const friendSubreddit = subredditFromPath(request.path, '/api/friend');
  if (friendSubreddit !== null) {
    const username = formText(form, 'name');
    const type = formText(form, 'type');
    if (username.length === 0) return { supported: false };
    if (type === 'banned') {
      await redditCall(roots, 'banUser', [{
        subredditName: friendSubreddit,
        username,
        reason: formText(form, 'ban_reason').slice(0, 100),
        note: formText(form, 'note').slice(0, 300),
      }]);
      return { supported: true, status: 200, body: successBody() };
    }
    if (type === 'muted') {
      await redditCall(roots, 'muteUser', [{
        subredditName: friendSubreddit,
        username,
        note: formText(form, 'note').slice(0, 300),
      }]);
      return { supported: true, status: 200, body: successBody() };
    }
    return { supported: false };
  }

  const unfriendSubreddit = subredditFromPath(request.path, '/api/unfriend');
  if (unfriendSubreddit !== null) {
    const username = formText(form, 'name');
    const type = formText(form, 'type');
    if (username.length === 0) return { supported: false };
    if (type === 'banned') {
      await redditCall(roots, 'unbanUser', [username, unfriendSubreddit]);
      return { supported: true, status: 200, body: successBody() };
    }
    if (type === 'muted') {
      await redditCall(roots, 'unmuteUser', [username, unfriendSubreddit]);
      return { supported: true, status: 200, body: successBody() };
    }
    return { supported: false };
  }

  if (request.path === '/api/compose') {
    const to = formText(form, 'to');
    if (to.length === 0) return { supported: false };
    await redditCall(roots, 'sendPrivateMessage', [{
      to,
      subject: formText(form, 'subject').slice(0, 100),
      text: formText(form, 'text'),
    }]);
    return { supported: true, status: 200, body: successBody() };
  }

  const replyId = modmailId(request.path);
  if (replyId !== null) {
    const body = formText(form, 'body').trim();
    if (body.length === 0) return { supported: false };
    await run(roots, 'reddit', [
      { kind: 'get', name: 'modMail' },
      {
        kind: 'call',
        name: 'reply',
        args: [{
          conversationId: replyId,
          body,
          isAuthorHidden: formText(form, 'isAuthorHidden') === 'true',
          isInternal: formText(form, 'isInternal') === 'true',
        }],
      },
    ]);
    return { supported: true, status: 200, body: successBody() };
  }

  const archiveId = modmailId(request.path, '/archive');
  if (archiveId !== null) {
    await run(roots, 'reddit', [
      { kind: 'get', name: 'modMail' },
      { kind: 'call', name: 'archiveConversation', args: [archiveId] },
    ]);
    return { supported: true, status: 200, body: successBody() };
  }

  const muteId = modmailId(request.path, '/mute');
  if (muteId !== null) {
    const hours = Number(formText(form, 'num_hours'));
    if (hours !== 72 && hours !== 168 && hours !== 672) return { supported: false };
    await run(roots, 'reddit', [
      { kind: 'get', name: 'modMail' },
      { kind: 'call', name: 'muteConversation', args: [{ conversationId: muteId, numHours: hours }] },
    ]);
    return { supported: true, status: 200, body: successBody() };
  }

  const unmuteId = modmailId(request.path, '/unmute');
  if (unmuteId !== null) {
    await run(roots, 'reddit', [
      { kind: 'get', name: 'modMail' },
      { kind: 'call', name: 'unmuteConversation', args: [unmuteId] },
    ]);
    return { supported: true, status: 200, body: successBody() };
  }

  if (request.path === '/api/set_subreddit_sticky') {
    const id = formText(form, 'id');
    const slot = Number(formText(form, 'num'));
    const state = formText(form, 'state');
    if (!/^t3_[A-Za-z0-9]+$/u.test(id) || (slot !== 1 && slot !== 2) || state !== 'true') {
      return { supported: false };
    }
    await run(roots, 'reddit', [
      { kind: 'call', name: 'getPostById', args: [id] },
      { kind: 'call', name: 'sticky', args: [slot] },
    ]);
    return { supported: true, status: 200, body: successBody() };
  }

  if (request.path === '/api/mod/notes') {
    const subreddit = formText(form, 'subreddit');
    const user = formText(form, 'user');
    const note = formText(form, 'note');
    if (subreddit.length === 0 || user.length === 0 || note.length === 0) return { supported: false };
    const options: Record<string, Wire> = { subreddit, user, note };
    const label = formText(form, 'label');
    const redditId = formText(form, 'reddit_id');
    if (label.length > 0) options['label'] = label;
    if (redditId.length > 0) options['redditId'] = redditId;
    const created = map(await redditCall(roots, 'addModNote', [options]), 'Devvit created mod note');
    return {
      supported: true,
      status: 200,
      body: { id: text(created['id']) },
    };
  }

  // /api/comment (PM thread reply), /api/read_message, /api/flairselector,
  // custom emoji administration and unsupported media forms deliberately fall
  // through to the legacy OAuth transport.
  return { supported: false };
};

export const handleLegacyRequest = async (
  request: LegacyCompatRequest,
  roots: AdapterRoots,
): Promise<LegacyCompatResponse> => {
  const read = await handleLegacyRead(request, roots);
  if (read.supported) return read;
  return await handleLegacyMutation(request, roots);
};
