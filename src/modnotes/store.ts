import { Store } from '../store/store.ts';
import { isMap, type Json, type JsonMap } from '../types/json.ts';

export type MemberModNoteLabel =
  | 'NONE'
  | 'HELPFUL_USER'
  | 'SOLID_CONTRIBUTOR'
  | 'SPAM_WATCH'
  | 'SPAM_WARNING'
  | 'ABUSE_WARNING';

export type MemberNativeModNote = {
  readonly subreddit: string;
  readonly noteId: string;
};

export type MemberModNoteRecord = {
  readonly username: string;
  readonly note: string | null;
  readonly summary: string | null;
  readonly label: MemberModNoteLabel | null;
  readonly sampledCommentFullnames: readonly string[];
  readonly generatedAt: number | null;
  readonly appliedTo: readonly string[];
  readonly nativeNotes: readonly MemberNativeModNote[];
  readonly error: string | null;
};

const initial = (): JsonMap => ({
  schema: 1,
  users: {},
});

const textOrNull = (value: Json | undefined): string | null => typeof value === 'string' ? value : null;
const integerOrNull = (value: Json | undefined): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

const label = (value: Json | undefined): MemberModNoteLabel | null => {
  if (
    value === 'NONE'
    || value === 'HELPFUL_USER'
    || value === 'SOLID_CONTRIBUTOR'
    || value === 'SPAM_WATCH'
    || value === 'SPAM_WARNING'
    || value === 'ABUSE_WARNING'
  ) return value;
  return null;
};

const stringList = (value: Json | undefined): readonly string[] => Array.isArray(value)
  ? value.filter((entry): entry is string => typeof entry === 'string')
  : [];

const nativeNotes = (value: Json | undefined): readonly MemberNativeModNote[] => {
  if (!Array.isArray(value)) return [];
  const out: MemberNativeModNote[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isMap(raw) || typeof raw['subreddit'] !== 'string' || typeof raw['noteId'] !== 'string') continue;
    const subreddit = raw['subreddit'].trim().toLowerCase();
    const noteId = raw['noteId'].trim();
    if (subreddit.length === 0 || !noteId.startsWith('ModNote_') || seen.has(subreddit)) continue;
    seen.add(subreddit);
    out.push({ subreddit, noteId });
  }
  return out.sort((a, b) => a.subreddit.localeCompare(b.subreddit));
};

const root = (value: Json): JsonMap => {
  if (!isMap(value) || value['schema'] !== 1) throw new Error('Unsupported member mod-note store');
  if (!isMap(value['users'])) value['users'] = {};
  return value;
};

const recordFrom = (value: Json | undefined): MemberModNoteRecord | null => {
  if (!isMap(value) || typeof value['username'] !== 'string') return null;
  return {
    username: value['username'],
    note: textOrNull(value['note']),
    summary: textOrNull(value['summary']),
    label: label(value['label']),
    sampledCommentFullnames: stringList(value['sampledCommentFullnames']),
    generatedAt: integerOrNull(value['generatedAt']),
    appliedTo: stringList(value['appliedTo']),
    nativeNotes: nativeNotes(value['nativeNotes']),
    error: textOrNull(value['error']),
  };
};

const recordJson = (value: MemberModNoteRecord): JsonMap => ({
  username: value.username,
  note: value.note,
  summary: value.summary,
  label: value.label,
  sampledCommentFullnames: [...value.sampledCommentFullnames],
  generatedAt: value.generatedAt,
  appliedTo: [...value.appliedTo],
  nativeNotes: value.nativeNotes.map(entry => ({ subreddit: entry.subreddit, noteId: entry.noteId })),
  error: value.error,
});

const blank = (username: string): MemberModNoteRecord => ({
  username,
  note: null,
  summary: null,
  label: null,
  sampledCommentFullnames: [],
  generatedAt: null,
  appliedTo: [],
  nativeNotes: [],
  error: null,
});

export class MemberModNoteStore {
  private readonly store: Store;

  public constructor(file = 'data/memberModNotes.pb') {
    this.store = new Store(file, initial());
  }

  public async seed(usernames: readonly string[]): Promise<void> {
    await this.store.edit(current => {
      const value = root(current);
      const users = value['users'];
      if (!isMap(users)) throw new Error('Member mod-note users map is invalid');
      for (const raw of usernames) {
        const username = raw.trim();
        if (username.length === 0) continue;
        const key = username.toLowerCase();
        if (!Object.hasOwn(users, key)) users[key] = recordJson(blank(username));
      }
      return value;
    });
  }

  public async record(username: string): Promise<MemberModNoteRecord | null> {
    const value = root(await this.store.read());
    const users = value['users'];
    if (!isMap(users)) throw new Error('Member mod-note users map is invalid');
    return recordFrom(users[username.trim().toLowerCase()]);
  }

  public async records(): Promise<readonly MemberModNoteRecord[]> {
    const value = root(await this.store.read());
    const users = value['users'];
    if (!isMap(users)) throw new Error('Member mod-note users map is invalid');
    return Object.values(users)
      .map(recordFrom)
      .filter((entry): entry is MemberModNoteRecord => entry !== null)
      .sort((a, b) => a.username.localeCompare(b.username));
  }

  public async generated(
    username: string,
    note: string,
    summary: string,
    selectedLabel: MemberModNoteLabel,
    sampledCommentFullnames: readonly string[],
    at: number,
  ): Promise<void> {
    await this.store.edit(current => {
      const value = root(current);
      const users = value['users'];
      if (!isMap(users)) throw new Error('Member mod-note users map is invalid');
      const key = username.trim().toLowerCase();
      const previous = recordFrom(users[key]) ?? blank(username);
      users[key] = recordJson({
        ...previous,
        username: previous.username || username,
        note,
        summary,
        label: selectedLabel,
        sampledCommentFullnames: [...sampledCommentFullnames],
        generatedAt: at,
        appliedTo: [],
        error: null,
      });
      return value;
    });
  }

  public async failed(username: string, error: string): Promise<void> {
    await this.store.edit(current => {
      const value = root(current);
      const users = value['users'];
      if (!isMap(users)) throw new Error('Member mod-note users map is invalid');
      const key = username.trim().toLowerCase();
      const previous = recordFrom(users[key]) ?? blank(username);
      users[key] = recordJson({ ...previous, error: error.trim().slice(0, 1_000) });
      return value;
    });
  }

  public async markApplied(username: string, subreddit: string): Promise<void> {
    await this.store.edit(current => {
      const value = root(current);
      const users = value['users'];
      if (!isMap(users)) throw new Error('Member mod-note users map is invalid');
      const key = username.trim().toLowerCase();
      const previous = recordFrom(users[key]);
      if (previous === null) throw new Error(`Member mod-note record is missing for u/${username}`);
      const community = subreddit.trim().toLowerCase();
      const applied = new Set(previous.appliedTo.map(value => value.toLowerCase()));
      applied.add(community);
      users[key] = recordJson({ ...previous, appliedTo: [...applied].sort(), error: null });
      return value;
    });
  }

  public async markNativeNote(username: string, subreddit: string, noteId: string): Promise<void> {
    const community = subreddit.trim().toLowerCase();
    const id = noteId.trim();
    if (community.length === 0) throw new Error('Native Mod Note subreddit cannot be empty');
    if (!id.startsWith('ModNote_')) throw new Error(`Invalid native Mod Note id ${noteId}`);
    await this.store.edit(current => {
      const value = root(current);
      const users = value['users'];
      if (!isMap(users)) throw new Error('Member mod-note users map is invalid');
      const key = username.trim().toLowerCase();
      const previous = recordFrom(users[key]) ?? blank(username);
      const mapped = new Map(previous.nativeNotes.map(entry => [entry.subreddit.toLowerCase(), entry.noteId]));
      mapped.set(community, id);
      users[key] = recordJson({
        ...previous,
        nativeNotes: [...mapped.entries()]
          .map(([subredditName, nativeId]) => ({ subreddit: subredditName, noteId: nativeId }))
          .sort((a, b) => a.subreddit.localeCompare(b.subreddit)),
        error: null,
      });
      return value;
    });
  }
}
