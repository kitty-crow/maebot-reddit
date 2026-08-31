import type { RedditModerationCfg } from '../env.ts';
import { RedditModerationClassifier, type ModerationItem } from '../mod/classifier.ts';
import type { RedditReadClient } from '../reddit/client.ts';
import { safeError } from '../reddit/error.ts';
import type { RedditComment, RedditPost } from '../reddit/types.ts';
import { Store } from '../store/store.ts';
import { isMap, type Json, type JsonMap } from '../types/json.ts';
import type { MemberModNoteRuntime, MemberModNoteScoreReader } from './runtime.ts';

export type MemberModNoteWatchReader = Pick<RedditReadClient, 'newPosts' | 'newComments'>;
export type MemberModNoteWatchScoreReader = MemberModNoteScoreReader & {
  hasContribution(fullname: string): Promise<boolean>;
};

export type MemberModNoteWatchTick = {
  readonly seeded: number;
  readonly discovered: number;
  readonly updated: number;
  readonly skipped: number;
  readonly failed: number;
};

type WatchItem = {
  readonly fullname: string;
  readonly kind: 'post' | 'comment';
  readonly subreddit: string;
  readonly author: string | null;
  readonly createdAt: number;
  readonly text: string;
  readonly moderation: ModerationItem;
};

const initial = (): JsonMap => ({
  schema: 1,
  bootstrapped: false,
  seen: [],
});

const root = (value: Json): JsonMap => {
  if (!isMap(value) || value['schema'] !== 1) throw new Error('Unsupported member Mod Note watch store');
  if (!Array.isArray(value['seen'])) value['seen'] = [];
  return value;
};

const seenFrom = (value: JsonMap): readonly string[] => {
  const seen = value['seen'];
  return Array.isArray(seen) ? seen.filter((entry): entry is string => typeof entry === 'string') : [];
};

class MemberModNoteWatchStore {
  private readonly store: Store;

  public constructor(file = 'data/memberModNoteWatch.pb') {
    this.store = new Store(file, initial());
  }

  public async bootstrapped(): Promise<boolean> {
    return root(await this.store.read())['bootstrapped'] === true;
  }

  public async seen(): Promise<ReadonlySet<string>> {
    return new Set(seenFrom(root(await this.store.read())));
  }

  public async mark(fullnames: readonly string[], bootstrap = false): Promise<void> {
    if (fullnames.length === 0 && !bootstrap) return;
    await this.store.edit(current => {
      const value = root(current);
      const combined = new Set(seenFrom(value));
      for (const fullname of fullnames) combined.add(fullname);
      const all = [...combined];
      value['seen'] = all.slice(Math.max(0, all.length - 5_000));
      if (bootstrap) value['bootstrapped'] = true;
      return value;
    });
  }
}

const postText = (post: RedditPost): string =>
  [post.title, post.selfText, post.url].filter(value => value.trim().length > 0).join('\n\n');

const postItem = (post: RedditPost): WatchItem => ({
  fullname: post.fullname,
  kind: 'post',
  subreddit: post.subreddit,
  author: post.author,
  createdAt: post.createdUtc,
  text: postText(post),
  moderation: {
    kind: 'post',
    subreddit: post.subreddit,
    author: post.author ?? '[deleted]',
    title: post.title,
    text: [post.selfText, post.url].filter(value => value.trim().length > 0).join('\n\n'),
    permalink: post.permalink,
    mediaUrls: post.mediaUrls,
    history: null,
  },
});

const commentItem = (comment: RedditComment): WatchItem => ({
  fullname: comment.fullname,
  kind: 'comment',
  subreddit: comment.subreddit,
  author: comment.author,
  createdAt: comment.createdUtc,
  text: comment.body,
  moderation: {
    kind: 'comment',
    subreddit: comment.subreddit,
    author: comment.author ?? '[deleted]',
    title: '',
    text: comment.body,
    permalink: comment.permalink,
    mediaUrls: comment.mediaUrls,
    history: null,
  },
});

const uniqueCommunities = (input: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const value = raw.trim().replace(/^r\//iu, '');
    if (value.length === 0) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  if (out.length === 0) throw new Error('Member Mod Note watcher requires at least one community');
  return out;
};

export class MemberModNoteWatchRuntime {
  private readonly communities: readonly string[];
  private readonly classifier: RedditModerationClassifier;
  private readonly store: MemberModNoteWatchStore;

  public constructor(
    communities: readonly string[],
    cfg: RedditModerationCfg,
    private readonly reader: MemberModNoteWatchReader,
    private readonly scores: MemberModNoteWatchScoreReader,
    private readonly notes: MemberModNoteRuntime,
    stateFile = 'data/memberModNoteWatch.pb',
  ) {
    this.communities = uniqueCommunities(communities);
    this.classifier = new RedditModerationClassifier(cfg.ai, { conversation: false });
    this.store = new MemberModNoteWatchStore(stateFile);
  }

  private async items(): Promise<readonly WatchItem[]> {
    const batches = await Promise.all(this.communities.map(async subreddit => {
      const [posts, comments] = await Promise.all([
        this.reader.newPosts(subreddit, 100),
        this.reader.newComments(subreddit, 100),
      ]);
      return [...posts.map(postItem), ...comments.map(commentItem)];
    }));
    const unique = new Map<string, WatchItem>();
    for (const item of batches.flat()) unique.set(item.fullname, item);
    return [...unique.values()].sort((a, b) => a.createdAt - b.createdAt || a.fullname.localeCompare(b.fullname));
  }

  public async tick(): Promise<MemberModNoteWatchTick> {
    const items = await this.items();
    if (!await this.store.bootstrapped()) {
      await this.store.mark(items.map(item => item.fullname), true);
      return { seeded: items.length, discovered: items.length, updated: 0, skipped: items.length, failed: 0 };
    }

    const seen = await this.store.seen();
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const item of items) {
      if (seen.has(item.fullname)) continue;
      if (item.author === null) {
        await this.store.mark([item.fullname]);
        skipped += 1;
        continue;
      }

      try {
        // The note watcher is downstream of scoring. If the canonical scoring
        // runtime has not recorded this item yet, leave it unseen and retry on
        // a later tick instead of racing or mutating reputation here.
        if (!await this.scores.hasContribution(item.fullname)) continue;

        const score = await this.scores.user(item.author);
        if (score === null) continue;
        if (score.status === 'moderator') {
          await this.store.mark([item.fullname]);
          skipped += 1;
          continue;
        }

        const classification = await this.classifier.classify(item.moderation);
        const result = await this.notes.observe({
          fullname: item.fullname,
          kind: item.kind,
          subreddit: item.subreddit,
          author: item.author,
          text: item.text,
          classification,
        });
        await this.store.mark([item.fullname]);
        if (result.updated) updated += 1;
        else skipped += 1;
        failed += result.failed;
      } catch (error) {
        failed += 1;
        console.error(`[Reddit member notes] ${item.fullname} failed: ${safeError(error)}`);
      }
    }

    return { seeded: 0, discovered: items.length, updated, skipped, failed };
  }
}
