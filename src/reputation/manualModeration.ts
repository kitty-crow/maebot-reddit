import type { RedditMutationClient } from '../reddit/mutate.ts';
import { Store } from '../store/store.ts';
import { isMap, type Json, type JsonMap } from '../types/json.ts';
import { clampReputationPoints, tierForPoints } from './policy.ts';

export type ManualModerationActor = {
  readonly platform: 'telegram' | 'discord';
  readonly userId: string;
  readonly userName: string;
};

export type ManualUserAction =
  | { readonly kind: 'set-score'; readonly points: number }
  | { readonly kind: 'set-flair'; readonly flair: string }
  | { readonly kind: 'ban' }
  | { readonly kind: 'unban' }
  | { readonly kind: 'mute' }
  | { readonly kind: 'unmute' };

export type ManualUserActionResult = {
  readonly username: string;
  readonly kind: ManualUserAction['kind'];
  readonly detail: string;
};

type MutationWriter = Pick<
  RedditMutationClient,
  'setUserFlairTemplate' | 'banUser' | 'unbanUser' | 'muteUser' | 'unmuteUser'
>;

const initial = (): JsonMap => ({
  schema: 1,
  subreddit: '',
  bootstrappedAt: 0,
  flairCatalog: { user: [], post: [] },
  flairReferences: { user: {}, post: {} },
  users: {},
  contributions: {},
  reputationJournal: {},
  discipline: {},
  notices: {},
  coverage: {},
});

const root = (value: Json): JsonMap => {
  if (!isMap(value) || value['schema'] !== 1) throw new Error('Unsupported reputation store');
  if (!isMap(value['users'])) throw new Error('Reputation users map is unavailable');
  if (!isMap(value['reputationJournal'])) value['reputationJournal'] = {};
  if (!isMap(value['discipline'])) value['discipline'] = {};
  return value;
};

const text = (value: Json | undefined): string => typeof value === 'string' ? value : '';
const bool = (value: Json | undefined): boolean => value === true;
const integer = (value: Json | undefined, fallback = 0): number =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback;

const userMap = (value: JsonMap, username: string): JsonMap => {
  const users = value['users'];
  if (!isMap(users)) throw new Error('Reputation users map is unavailable');
  const raw = users[username.trim().toLowerCase()];
  if (!isMap(raw)) throw new Error(`Reputation user u/${username} was not found`);
  return raw;
};

const assertMutableMember = (user: JsonMap): void => {
  if (text(user['status']) === 'moderator' || bool(user['immutableModeratorFlair'])) {
    throw new Error('Moderator reputation/flair is immutable');
  }
};

const actorText = (actor: ManualModerationActor): string =>
  `${actor.platform}:${actor.userName || actor.userId}:${actor.userId}`;

const journal = (
  value: JsonMap,
  username: string,
  actor: ManualModerationActor,
  kind: string,
  detail: JsonMap = {},
): void => {
  const entries = value['reputationJournal'];
  if (!isMap(entries)) throw new Error('Reputation journal is unavailable');
  const at = Math.floor(Date.now() / 1_000);
  const key = `dashboard:${kind}:${username.trim().toLowerCase()}:${at}:${crypto.randomUUID()}`;
  entries[key] = {
    kind: `dashboard-${kind}`,
    username,
    at,
    actor: actorText(actor),
    ...detail,
  };
};

const statusForPoints = (points: number): 'ordinary' | 'warned' | 'uncivil' => {
  if (points >= 0) return 'ordinary';
  if (points <= -4) return 'uncivil';
  return 'warned';
};

const flairTemplate = (value: JsonMap, selector: string): { readonly id: string; readonly text: string; readonly css: string | null } => {
  const catalog = value['flairCatalog'];
  if (!isMap(catalog) || !Array.isArray(catalog['user'])) throw new Error('Reputation user flair catalogue is unavailable');
  const wanted = selector.trim();
  if (wanted.length === 0) throw new Error('Flair cannot be empty');
  const folded = wanted.toLocaleLowerCase();
  const matches = catalog['user'].flatMap(raw => {
    if (!isMap(raw)) return [];
    const id = text(raw['id']);
    const label = text(raw['text']);
    const css = raw['cssClass'] === null || typeof raw['cssClass'] !== 'string' ? null : raw['cssClass'];
    if (id.length === 0) return [];
    return id === wanted || label.toLocaleLowerCase() === folded || (css ?? '').toLocaleLowerCase() === folded
      ? [{ id, text: label, css }]
      : [];
  });
  if (matches.length === 0) throw new Error(`Reddit flair '${wanted}' was not found`);
  if (matches.length > 1) throw new Error(`Reddit flair '${wanted}' is ambiguous; use its template ID`);
  return matches[0] as { readonly id: string; readonly text: string; readonly css: string | null };
};

const discipline = (value: JsonMap, username: string): JsonMap => {
  const records = value['discipline'];
  if (!isMap(records)) throw new Error('Reputation discipline map is unavailable');
  const key = username.trim().toLowerCase();
  const existing = records[key];
  if (isMap(existing)) return existing;
  const created: JsonMap = {
    muteUntil: null,
    mutePermanent: false,
    redditMuted: false,
    muteAppliedAt: null,
  };
  records[key] = created;
  return created;
};

export class ManualReputationModeration {
  private readonly store: Store;

  public constructor(
    stateFile: string,
    private readonly subreddit: string,
    private readonly writer: MutationWriter,
  ) {
    this.store = new Store(stateFile, initial());
  }

  public async apply(
    rawUsername: string,
    action: ManualUserAction,
    actor: ManualModerationActor,
  ): Promise<ManualUserActionResult> {
    const username = rawUsername.trim().replace(/^u\//u, '');
    if (!/^[A-Za-z0-9_-]{3,32}$/u.test(username)) throw new Error('Invalid Reddit username');

    if (action.kind === 'set-score') {
      const points = clampReputationPoints(action.points);
      await this.store.edit(current => {
        const value = root(current);
        const user = userMap(value, username);
        assertMutableMember(user);
        const before = integer(user['points']);
        user['points'] = points;
        user['tier'] = tierForPoints(points);
        journal(value, username, actor, 'set-score', { beforePoints: before, afterPoints: points });
        return value;
      });
      return { username, kind: action.kind, detail: `score set to ${points}` };
    }

    if (action.kind === 'set-flair') {
      const value = root(await this.store.read());
      const user = userMap(value, username);
      assertMutableMember(user);
      const template = flairTemplate(value, action.flair);
      await this.writer.setUserFlairTemplate(this.subreddit, username, template.id, null);
      await this.store.edit(current => {
        const next = root(current);
        const stored = userMap(next, username);
        assertMutableMember(stored);
        stored['currentFlairTemplateId'] = template.id;
        stored['currentFlairText'] = template.text;
        stored['currentFlairCssClass'] = template.css;
        stored['desiredFlairTemplateId'] = template.id;
        stored['desiredFlairText'] = template.text;
        stored['needsFlair'] = false;
        journal(next, username, actor, 'set-flair', { templateId: template.id, flairText: template.text });
        return next;
      });
      return { username, kind: action.kind, detail: `flair set to ${template.text || template.id}` };
    }

    if (action.kind === 'ban') {
      await this.writer.banUser(
        this.subreddit,
        username,
        'Moderator action from Mae Dashboard',
        `Mae Dashboard: ${actorText(actor)}`,
      );
      await this.store.edit(current => {
        const value = root(current);
        const user = userMap(value, username);
        assertMutableMember(user);
        const before = text(user['status']);
        user['status'] = 'banned';
        journal(value, username, actor, 'ban', { beforeStatus: before, afterStatus: 'banned' });
        return value;
      });
      return { username, kind: action.kind, detail: 'user banned' };
    }

    if (action.kind === 'unban') {
      await this.writer.unbanUser(this.subreddit, username);
      await this.store.edit(current => {
        const value = root(current);
        const user = userMap(value, username);
        assertMutableMember(user);
        const before = text(user['status']);
        const after = statusForPoints(integer(user['points']));
        user['status'] = after;
        journal(value, username, actor, 'unban', { beforeStatus: before, afterStatus: after });
        return value;
      });
      return { username, kind: action.kind, detail: 'user unbanned' };
    }

    if (action.kind === 'mute') {
      await this.writer.muteUser(this.subreddit, username, `Mae Dashboard: ${actorText(actor)}`);
      await this.store.edit(current => {
        const value = root(current);
        userMap(value, username);
        const record = discipline(value, username);
        const now = Date.now();
        record['muteUntil'] = now + (28 * 24 * 60 * 60 * 1_000);
        record['mutePermanent'] = false;
        record['redditMuted'] = true;
        record['muteAppliedAt'] = now;
        journal(value, username, actor, 'mute', { durationDays: 28 });
        return value;
      });
      return { username, kind: action.kind, detail: 'user muted for 28 days' };
    }

    await this.writer.unmuteUser(this.subreddit, username);
    await this.store.edit(current => {
      const value = root(current);
      userMap(value, username);
      const record = discipline(value, username);
      record['muteUntil'] = null;
      record['mutePermanent'] = false;
      record['redditMuted'] = false;
      record['muteAppliedAt'] = Date.now();
      journal(value, username, actor, 'unmute');
      return value;
    });
    return { username, kind: action.kind, detail: 'user unmuted' };
  }
}
