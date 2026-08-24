import { Store } from '../store/store.ts';
import { isMap, type Json, type JsonMap } from '../types/json.ts';
import type { RedditMuteApplicationState } from './mutePolicy.ts';

const initial = (): JsonMap => ({
  schema: 1,
  communities: {},
});

const root = (value: Json): JsonMap => {
  if (!isMap(value) || value['schema'] !== 1) throw new Error('Unsupported community projection store');
  if (!isMap(value['communities'])) value['communities'] = {};
  return value;
};

const community = (value: JsonMap, subreddit: string): JsonMap => {
  const communities = value['communities'];
  if (!isMap(communities)) throw new Error('Community projection map is missing');
  const key = subreddit.trim().toLowerCase();
  const existing = communities[key];
  if (isMap(existing)) {
    if (!isMap(existing['mutes'])) existing['mutes'] = {};
    return existing;
  }
  const created: JsonMap = { mutes: {} };
  communities[key] = created;
  return created;
};

const bool = (value: Json | undefined): boolean => value === true;
const integerOrNull = (value: Json | undefined): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null;

export class CommunityProjectionStore {
  private readonly store: Store;

  public constructor(file = 'data/communityProjection.pb') {
    this.store = new Store(file, initial());
  }

  public async muteState(subreddit: string, username: string): Promise<RedditMuteApplicationState> {
    const value = root(await this.store.read());
    const record = community(value, subreddit);
    const mutes = record['mutes'];
    if (!isMap(mutes)) throw new Error('Community projection mute map is missing');
    const mute = mutes[username.trim().toLowerCase()];
    if (!isMap(mute)) return { redditMuted: false, appliedAt: null };
    return {
      redditMuted: bool(mute['redditMuted']),
      appliedAt: integerOrNull(mute['appliedAt']),
    };
  }

  public async markMute(
    subreddit: string,
    username: string,
    action: 'mute' | 'unmute',
    atMs: number,
  ): Promise<void> {
    await this.store.edit(current => {
      const value = root(current);
      const record = community(value, subreddit);
      const mutes = record['mutes'];
      if (!isMap(mutes)) throw new Error('Community projection mute map is missing');
      mutes[username.trim().toLowerCase()] = {
        redditMuted: action === 'mute',
        appliedAt: action === 'mute' ? atMs : null,
      };
      return value;
    });
  }
}
