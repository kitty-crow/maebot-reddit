import {
  executeAdapterCommand,
  type AdapterCommand,
  type AdapterRoots,
  type AdapterStep,
  type Wire,
} from './controller.ts';
import type {
  LegacyCompatRequest,
  LegacyCompatResponse,
} from './legacyCompat.ts';

type WireMap = { readonly [key: string]: Wire };

let nextId = 0;

const map = (value: Wire, context: string): WireMap => {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${context} was not an object`);
  }
  return value;
};

const text = (value: string | undefined): string => value ?? '';

const truthy = (value: string | undefined): boolean => value === 'true' || value === '1';

const integer = (value: string | undefined): number | null => {
  if (value === undefined || !/^-?\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const modNoteLabels = new Set([
  'BOT_BAN',
  'PERMA_BAN',
  'BAN',
  'ABUSE_WARNING',
  'SPAM_WARNING',
  'SPAM_WATCH',
  'SOLID_CONTRIBUTOR',
  'HELPFUL_USER',
]);

const run = async (
  roots: AdapterRoots,
  steps: readonly AdapterStep[],
): Promise<Wire> => {
  nextId += 1;
  const command: AdapterCommand = {
    id: `compat-mutation:${nextId}`,
    root: 'reddit',
    steps,
  };
  return await executeAdapterCommand(command, roots);
};

const call = async (
  roots: AdapterRoots,
  name: string,
  args: readonly Wire[] = [],
): Promise<Wire> => await run(roots, [{ kind: 'call', name, args }]);

const modMailCall = async (
  roots: AdapterRoots,
  name: string,
  args: readonly Wire[],
): Promise<Wire> => await run(roots, [
  { kind: 'get', name: 'modMail' },
  { kind: 'call', name, args },
]);

const createdPostEnvelope = (value: Wire): Wire => {
  const raw = map(value, 'Devvit created post');
  const rawId = typeof raw['id'] === 'string' ? raw['id'] : '';
  const id = rawId.startsWith('t3_') ? rawId.slice(3) : rawId;
  const name = rawId.startsWith('t3_') ? rawId : `t3_${rawId}`;
  return {
    json: {
      errors: [],
      data: {
        id,
        name,
        url: typeof raw['url'] === 'string' ? raw['url'] : '',
      },
    },
  };
};

const emptyEnvelope = (): Wire => ({ json: { errors: [] } });

const subredditPath = (path: string, suffix: string): string | null => {
  if (!path.startsWith('/r/') || !path.endsWith(suffix)) return null;
  const encoded = path.slice(3, path.length - suffix.length);
  if (encoded.length === 0 || encoded.includes('/')) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
};

const flairOptions = (
  subredditName: string,
  form: Readonly<Record<string, string>>,
): WireMap => ({
  subredditName,
  text: text(form['text']),
  modOnly: truthy(form['mod_only']),
  allowUserEdits: truthy(form['text_editable']),
  ...(form['background_color'] === undefined ? {} : { backgroundColor: form['background_color'] }),
  ...(form['text_color'] === 'light' || form['text_color'] === 'dark'
    ? { textColor: form['text_color'] }
    : {}),
  ...(form['allowable_content'] === 'all'
    || form['allowable_content'] === 'emoji'
    || form['allowable_content'] === 'text'
    ? { allowableContent: form['allowable_content'] }
    : {}),
  ...(integer(form['max_emojis']) === null ? {} : { maxEmojis: integer(form['max_emojis'])! }),
});

const submit = async (
  roots: AdapterRoots,
  form: Readonly<Record<string, string>>,
): Promise<LegacyCompatResponse> => {
  const subredditName = form['sr'];
  const title = form['title'];
  const kind = form['kind'];
  if (subredditName === undefined || title === undefined) return { supported: false };

  if (kind === 'self') {
    const value = await call(roots, 'submitPost', [{
      subredditName,
      title,
      text: form['text'] ?? '',
      sendreplies: form['sendreplies'] !== 'false',
      runAs: 'APP',
      ...(form['flair_id'] === undefined ? {} : { flairId: form['flair_id'] }),
    }]);
    return { supported: true, status: 200, body: createdPostEnvelope(value) };
  }

  if (kind === 'crosspost' && form['crosspost_fullname'] !== undefined) {
    const value = await call(roots, 'crosspost', [{
      subredditName,
      postId: form['crosspost_fullname'],
      title,
      sendreplies: form['sendreplies'] !== 'false',
      runAs: 'APP',
      ...(form['flair_id'] === undefined ? {} : { flairId: form['flair_id'] }),
    }]);
    return { supported: true, status: 200, body: createdPostEnvelope(value) };
  }

  return { supported: false };
};

const selectFlair = async (
  roots: AdapterRoots,
  subredditName: string,
  form: Readonly<Record<string, string>>,
): Promise<LegacyCompatResponse> => {
  const templateId = form['flair_template_id'];
  if (templateId === undefined) return { supported: false };

  if (form['name'] !== undefined) {
    await call(roots, 'setUserFlair', [{
      subredditName,
      username: form['name'],
      flairTemplateId: templateId,
      ...(form['text'] === undefined ? {} : { text: form['text'] }),
    }]);
    return { supported: true, status: 200, body: emptyEnvelope() };
  }

  if (form['link'] !== undefined) {
    await call(roots, 'setPostFlair', [{
      subredditName,
      postId: form['link'],
      flairTemplateId: templateId,
      ...(form['text'] === undefined ? {} : { text: form['text'] }),
    }]);
    return { supported: true, status: 200, body: emptyEnvelope() };
  }

  return { supported: false };
};

const relationship = async (
  roots: AdapterRoots,
  subredditName: string,
  form: Readonly<Record<string, string>>,
  remove: boolean,
): Promise<LegacyCompatResponse> => {
  const username = form['name'];
  const type = form['type'];
  if (username === undefined || (type !== 'banned' && type !== 'muted')) return { supported: false };

  if (remove) {
    await call(
      roots,
      type === 'banned' ? 'unbanUser' : 'unmuteUser',
      [username, subredditName],
    );
    return { supported: true, status: 200, body: emptyEnvelope() };
  }

  if (type === 'muted') {
    // Mae's legacy contract explicitly requests a 28-day mute. Devvit 0.14.4
    // muteUser() exposes no duration option, so exact parity is unproven.
    return { supported: false };
  }

  await call(roots, 'banUser', [{
    subredditName,
    username,
    reason: (form['ban_reason'] ?? '').slice(0, 100),
    note: (form['note'] ?? '').slice(0, 300),
    ...(integer(form['duration']) === null ? {} : { duration: integer(form['duration'])! }),
  }]);
  return { supported: true, status: 200, body: emptyEnvelope() };
};

const modmail = async (
  request: LegacyCompatRequest,
  roots: AdapterRoots,
): Promise<LegacyCompatResponse> => {
  const form = request.form ?? {};

  const reply = /^\/api\/mod\/conversations\/([A-Za-z0-9]+)$/u.exec(request.path);
  if (request.method === 'POST' && reply !== null) {
    await modMailCall(roots, 'reply', [{
      conversationId: reply[1] ?? '',
      body: form['body'] ?? '',
      isAuthorHidden: truthy(form['isAuthorHidden']),
      isInternal: truthy(form['isInternal']),
    }]);
    return { supported: true, status: 200, body: emptyEnvelope() };
  }

  const action = /^\/api\/mod\/conversations\/([A-Za-z0-9]+)\/(archive|mute|unmute)$/u.exec(request.path);
  if (request.method === 'POST' && action !== null) {
    const id = action[1] ?? '';
    if (action[2] === 'archive') {
      await modMailCall(roots, 'archiveConversation', [id]);
    } else if (action[2] === 'unmute') {
      await modMailCall(roots, 'unmuteConversation', [id]);
    } else {
      const hours = integer(form['num_hours']);
      if (hours !== 72 && hours !== 168 && hours !== 672) return { supported: false };
      await modMailCall(roots, 'muteConversation', [{ conversationId: id, numHours: hours }]);
    }
    return { supported: true, status: 200, body: emptyEnvelope() };
  }

  return { supported: false };
};

const modNote = async (
  request: LegacyCompatRequest,
  roots: AdapterRoots,
): Promise<LegacyCompatResponse> => {
  const form = request.form ?? {};
  if (request.path !== '/api/mod/notes') return { supported: false };

  if (request.method === 'POST') {
    const subreddit = form['subreddit'];
    const user = form['user'];
    const note = form['note'];
    if (subreddit === undefined || user === undefined || note === undefined) return { supported: false };
    const label = form['label'];
    if (label !== undefined && !modNoteLabels.has(label)) return { supported: false };
    const redditId = form['reddit_id'];
    if (redditId !== undefined && !/^(?:t1|t3)_[A-Za-z0-9]+$/u.test(redditId)) {
      return { supported: false };
    }
    const value = await call(roots, 'addModNote', [{
      subreddit,
      user,
      note,
      ...(label === undefined ? {} : { label }),
      ...(redditId === undefined ? {} : { redditId }),
    }]);
    const raw = map(value, 'Devvit Mod Note');
    const id = typeof raw['id'] === 'string' ? raw['id'] : '';
    if (!id.startsWith('ModNote_')) throw new Error('Devvit addModNote returned no ModNote id');
    return { supported: true, status: 200, body: { id } };
  }

  if (request.method === 'DELETE') {
    const query = request.query ?? {};
    const subreddit = query['subreddit'];
    const user = query['user'];
    const noteId = query['note_id'];
    if (subreddit === undefined || user === undefined || noteId === undefined) return { supported: false };
    await call(roots, 'deleteModNote', [{ subreddit, user, noteId }]);
    return { supported: true, status: 200, body: null };
  }

  return { supported: false };
};

export const handleLegacyMutation = async (
  request: LegacyCompatRequest,
  roots: AdapterRoots,
): Promise<LegacyCompatResponse> => {
  const form = request.form ?? {};

  if (request.path === '/api/submit' && request.method === 'POST') {
    return await submit(roots, form);
  }

  const flairTemplate = subredditPath(request.path, '/api/flairtemplate_v2');
  if (request.method === 'POST' && flairTemplate !== null) {
    const type = form['flair_type'];
    if (type !== 'USER_FLAIR' && type !== 'LINK_FLAIR') return { supported: false };
    // Devvit 0.14.4 hardcodes legacy flair CSS class to empty when creating
    // templates. Any caller that needs a CSS class must retain OAuth parity.
    if ((form['css_class'] ?? '').length > 0) return { supported: false };
    await call(
      roots,
      type === 'USER_FLAIR' ? 'createUserFlairTemplate' : 'createPostFlairTemplate',
      [flairOptions(flairTemplate, form)],
    );
    return { supported: true, status: 200, body: emptyEnvelope() };
  }

  const select = subredditPath(request.path, '/api/selectflair');
  if (request.method === 'POST' && select !== null) {
    return await selectFlair(roots, select, form);
  }

  const directFlair = subredditPath(request.path, '/api/flair');
  if (request.method === 'POST' && directFlair !== null && form['name'] !== undefined) {
    await call(roots, 'setUserFlair', [{
      subredditName: directFlair,
      username: form['name'],
      text: form['text'] ?? '',
      cssClass: form['css_class'] ?? '',
    }]);
    return { supported: true, status: 200, body: emptyEnvelope() };
  }

  if (request.method === 'POST' && request.path === '/api/remove' && form['id'] !== undefined) {
    await call(roots, 'remove', [form['id'], form['spam'] === 'true']);
    return { supported: true, status: 200, body: emptyEnvelope() };
  }

  const friend = subredditPath(request.path, '/api/friend');
  if (request.method === 'POST' && friend !== null) {
    return await relationship(roots, friend, form, false);
  }

  const unfriend = subredditPath(request.path, '/api/unfriend');
  if (request.method === 'POST' && unfriend !== null) {
    return await relationship(roots, unfriend, form, true);
  }

  if (
    request.method === 'POST'
    && request.path === '/api/compose'
    && form['to'] !== undefined
    && form['subject'] !== undefined
  ) {
    await call(roots, 'sendPrivateMessage', [{
      to: form['to'],
      subject: form['subject'].slice(0, 100),
      text: form['text'] ?? '',
    }]);
    return { supported: true, status: 200, body: emptyEnvelope() };
  }

  if (request.method === 'POST' && request.path === '/api/set_subreddit_sticky' && form['id'] !== undefined) {
    if (form['state'] !== 'true') return { supported: false };
    const slot = integer(form['num']);
    if (slot !== 1 && slot !== 2) return { supported: false };
    await run(roots, [
      { kind: 'call', name: 'getPostById', args: [form['id']] },
      { kind: 'call', name: 'sticky', args: [slot] },
    ]);
    return { supported: true, status: 200, body: emptyEnvelope() };
  }

  const modmailResponse = await modmail(request, roots);
  if (modmailResponse.supported) return modmailResponse;

  return await modNote(request, roots);
};
