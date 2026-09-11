import { redditConfig } from '../env.ts';
import { RedditReadClient } from '../reddit/client.ts';
import type { RedditMutationClient } from '../reddit/mutate.ts';
import type { RedditFlairAssignment } from '../reddit/types.ts';
import { Store } from '../store/store.ts';
import { isMap, type Json, type JsonMap } from '../types/json.ts';
import { withRedditStateAdoption } from './manualOverrideGate.ts';
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
  | { readonly kind: 'unmute' }
  | { readonly kind: 'adopt-reddit-state' };

export type ManualUserActionResult = {
  readonly username: string;
  readonly kind: ManualUserAction['kind'];
  readonly detail: string;
};

type MutationWriter = Pick<
  RedditMutationClient,
  'setUserFlairTemplate' | 'banUser' | 'unbanUser' | 'muteUser' | 'unmuteUser'
>;

type LiveStateReader = Pick<
  RedditReadClient,
  'userFlairAssignment' | 'bannedUser' | 'mutedUser'
>;

const adoptionWireFlair = '__MAE_INTERNAL_ADOPT_REDDIT_STATE_V1__';

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
const nullableText = (value: Json | undefined): string | null => typeof value === 'string' ? value : null;
const bool = (value: Json | undefined): boolean => value === true;
const integer = (value: Json | undefined, fallback = 0): number =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback;
const lower = (value: string): string => value.trim().toLowerCase();

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
  if (points >= 1) return 'ordinary';
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

const liveFlairTemplate = (
  value: JsonMap,
  assignment: RedditFlairAssignment | undefined,
): { readonly id: string; readonly text: string; readonly css: string | null } | null => {
  if (assignment === undefined) return null;
  const catalog = value['flairCatalog'];
  if (!isMap(catalog) || !Array.isArray(catalog['user'])) throw new Error('Reputation user flair catalogue is unavailable');
  const candidates = catalog['user'].flatMap(raw => {
    if (!isMap(raw)) return [];
    const id = text(raw['id']);
    const label = text(raw['text']);
    const css = raw['cssClass'] === null || typeof raw['cssClass'] !== 'string' ? null : raw['cssClass'];
    if (id.length === 0) return [];
    const byId = assignment.templateId !== null && assignment.templateId === id;
    const byText = assignment.templateId === null && assignment.text !== null && assignment.text === label;
    const byCss = assignment.templateId === null && assignment.cssClass !== null && assignment.cssClass === css;
    return byId || byText || byCss ? [{ id, text: assignment.text ?? label, css: assignment.cssClass ?? css }] : [];
  });
  if (candidates.length === 0) {
    const description = assignment.templateId ?? assignment.text ?? assignment.cssClass ?? 'unknown flair';
    throw new Error(`Live Reddit flair '${description}' is not in Mae's canonical flair catalogue`);
  }
  if (candidates.length > 1) throw new Error('Live Reddit flair is ambiguous in Mae\'s canonical flair catalogue');
  return candidates[0] as { readonly id: string; readonly text: string; readonly css: string | null };
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

const clearHistoricalBanEffects = (value: JsonMap, username: string): number => {
  const contributions = value['contributions'];
  if (!isMap(contributions)) return 0;
  const wanted = lower(username);
  let changed = 0;
  for (const raw of Object.values(contributions)) {
    if (!isMap(raw) || lower(text(raw['author'])) !== wanted || !bool(raw['banRequired']) || bool(raw['banApplied'])) continue;
    raw['banApplied'] = true;
    changed += 1;
  }
  return changed;
};

const statusAdoptedFromLive = (user: JsonMap, liveBanned: boolean, liveMuted: boolean): string => {
  if (liveBanned) return 'banned';
  const current = text(user['status']);
  if (current === 'moderator') return current;
  if (current === 'banned' || current === 'scam' || current === 'unmapped') {
    const derived = statusForPoints(integer(user['points']));
    return !liveMuted && derived === 'uncivil' ? 'warned' : derived;
  }
  if (!liveMuted && current === 'uncivil') return 'warned';
  return current;
};

export class ManualReputationModeration {
  private readonly store: Store;

  public constructor(
    stateFile: string,
    private readonly subreddit: string,
    private readonly writer: MutationWriter,
    private readonly reader: LiveStateReader | null = null,
  ) {
    this.store = new Store(stateFile, initial());
  }

  private async adoptLiveRedditState(
    username: string,
    actor: ManualModerationActor,
  ): Promise<ManualUserActionResult> {
    // This is an explicit operator override, not part of Mae's normal polling
    // workload. Use one-user reads outside the background rate-budget and bound
    // the real network boundary so this administrative action cannot hang.
    const boundedFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
      await fetch(input, { ...init, signal: AbortSignal.timeout(10_000) });
    const reader = this.reader ?? new RedditReadClient(redditConfig().auth, { fetcher: boundedFetch, maxAttempts: 1 });

    // Sequential reads deliberately share one OAuth token instead of starting
    // three concurrent token requests on a fresh administrative reader.
    const assignment = await reader.userFlairAssignment(this.subreddit, username);
    const bannedUser = await reader.bannedUser(this.subreddit, username);
    const liveMute = await reader.mutedUser(this.subreddit, username);
    const liveBanned = bannedUser !== null;
    const liveMuted = liveMute !== null;
    const now = Date.now();
    let flairDescription = 'none';
    let clearedBanEffects = 0;

    await this.store.edit(current => {
      const value = root(current);
      const user = userMap(value, username);
      assertMutableMember(user);
      const beforeStatus = text(user['status']);
      const beforeFlairId = nullableText(user['desiredFlairTemplateId']);
      const adoptedFlair = liveFlairTemplate(value, assignment ?? undefined);
      if (adoptedFlair === null) {
        user['currentFlairTemplateId'] = null;
        user['currentFlairText'] = null;
        user['currentFlairCssClass'] = null;
        user['desiredFlairTemplateId'] = null;
        user['desiredFlairText'] = null;
        user['needsFlair'] = false;
      } else {
        flairDescription = adoptedFlair.text || adoptedFlair.id;
        user['currentFlairTemplateId'] = adoptedFlair.id;
        user['currentFlairText'] = adoptedFlair.text;
        user['currentFlairCssClass'] = adoptedFlair.css;
        user['desiredFlairTemplateId'] = adoptedFlair.id;
        user['desiredFlairText'] = adoptedFlair.text;
        user['needsFlair'] = false;
      }
      user['needsReview'] = false;

      const afterStatus = statusAdoptedFromLive(user, liveBanned, liveMuted);
      user['status'] = afterStatus;

      const record = discipline(value, username);
      if (liveMute === null) {
        record['muteUntil'] = null;
        record['mutePermanent'] = false;
        record['redditMuted'] = false;
        record['muteAppliedAt'] = null;
      } else {
        const observedStart = typeof liveMute.date === 'number' && Number.isFinite(liveMute.date)
          ? Math.floor(liveMute.date * 1_000)
          : now;
        const start = Number.isSafeInteger(observedStart) && observedStart > 0 && observedStart <= now ? observedStart : now;
        const observedUntil = start + (28 * 24 * 60 * 60 * 1_000);
        record['muteUntil'] = observedUntil > now ? observedUntil : now + (28 * 24 * 60 * 60 * 1_000);
        record['mutePermanent'] = false;
        record['redditMuted'] = true;
        record['muteAppliedAt'] = start;
      }

      clearedBanEffects = clearHistoricalBanEffects(value, username);
      journal(value, username, actor, 'adopt-reddit-state', {
        subreddit: this.subreddit,
        beforeStatus,
        afterStatus,
        beforeFlairTemplateId: beforeFlairId,
        afterFlairTemplateId: adoptedFlair?.id ?? null,
        liveBanned,
        liveMuted,
        clearedPendingBanEffects: clearedBanEffects,
      });
      return value;
    });

    return {
      username,
      kind: 'adopt-reddit-state',
      detail: `adopted live r/${this.subreddit} state: ${liveBanned ? 'banned' : 'not banned'}, ${liveMuted ? 'muted' : 'not muted'}, flair ${flairDescription}; cleared ${clearedBanEffects} pending historical ban effect(s)`,
    };
  }

  public async apply(
    rawUsername: string,
    action: ManualUserAction,
    actor: ManualModerationActor,
  ): Promise<ManualUserActionResult> {
    const username = rawUsername.trim().replace(/^u\//u, '');
    if (!/^[A-Za-z0-9_-]{3,32}$/u.test(username)) throw new Error('Invalid Reddit username');

    if (
      action.kind === 'adopt-reddit-state'
      || (action.kind === 'set-flair' && action.flair === adoptionWireFlair)
    ) {
      return await withRedditStateAdoption(username, async () => await this.adoptLiveRedditState(username, actor));
    }

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
