import { resolve } from 'node:path';
import {
  reconcileFlairCatalogue,
  type FlairCatalogueReader,
  type FlairCatalogueResolver,
} from '../flair/catalogue.ts';
import type { RedditCreatedPost } from '../reddit/mutate.ts';
import type { RedditPost } from '../reddit/types.ts';
import { mirrorKey, PostMirrorStore, type MirrorPending } from './store.ts';

export type MirrorReader = FlairCatalogueReader & {
  newPosts(subreddit: string, limit?: number): Promise<readonly RedditPost[]>;
};
export type MirrorWriter = {
  crosspost(subreddit: string, sourcePostId: string, title: string, flairTemplateId: string | null): Promise<RedditCreatedPost>;
  submitSelf(subreddit: string, title: string, body: string, flairTemplateId: string | null): Promise<RedditCreatedPost>;
};
export type PostMirrorSourceDecision = 'pending' | 'allow' | 'deny';
export type PostMirrorSourceGate = {
  decisions(fullnames: readonly string[]): Promise<ReadonlyMap<string, PostMirrorSourceDecision>>;
};
export type PostMirrorTick = { seeded: boolean; discovered: number; completed: number; failed: number };

type ObservedPost = {
  readonly subreddit: string;
  readonly targetSubreddit: string;
  readonly post: RedditPost;
};

type FallbackOrigin = {
  readonly subreddit: string | null;
  readonly fullname: string;
};

const lower = (value: string): string => value.toLowerCase();
const sameSubreddit = (left: string, right: string): boolean => lower(left) === lower(right);
const sourceUrl = (permalink: string): string => permalink.startsWith('http')
  ? permalink
  : `https://www.reddit.com${permalink.startsWith('/') ? '' : '/'}${permalink}`;
const tag = (subreddit: string, fullname: string): string =>
  `<!-- mae-mirror:v2:${subreddit}:${fullname} -->`;
const fallbackBody = (item: MirrorPending): string =>
  `Mirrored from r/${item.sourceSubreddit}.\n\n[Open the original post](${sourceUrl(item.permalink)})\n\n${tag(item.sourceSubreddit, item.sourceFullname)}`;
const safeError = <T>(error: T): string => error instanceof Error ? error.message : String(error);

const fallbackOrigin = (body: string): FallbackOrigin | null => {
  const current = /<!-- mae-mirror:v2:([A-Za-z0-9_]+):(t3_[A-Za-z0-9]+) -->/u.exec(body);
  if (current !== null) {
    const subreddit = current[1];
    const fullname = current[2];
    if (subreddit !== undefined && fullname !== undefined) return { subreddit, fullname };
  }
  const legacy = /<!-- mae-mirror:(t3_[A-Za-z0-9]+) -->/u.exec(body);
  const fullname = legacy?.[1];
  return fullname === undefined ? null : { subreddit: null, fullname };
};

const observedIdentity = (item: ObservedPost) => ({
  subreddit: item.subreddit,
  postId: item.post.id,
  fullname: item.post.fullname,
});

export class BidirectionalPostMirror {
  private flairs: FlairCatalogueResolver | null = null;
  private readonly catalogueFile: string;

  public constructor(
    private readonly read: MirrorReader,
    private readonly write: MirrorWriter,
    private readonly store: PostMirrorStore,
    private readonly firstSubreddit: string,
    private readonly secondSubreddit: string,
    private readonly gate: PostMirrorSourceGate | null = null,
    catalogueFile = resolve(
      process.cwd(),
      process.env['REDDIT_FLAIR_CATALOGUE_FILE']?.trim() || 'data/flairs.json',
    ),
  ) {
    if (sameSubreddit(firstSubreddit, secondSubreddit)) {
      throw new Error('Bidirectional Reddit mirror requires two different subreddits');
    }
    this.catalogueFile = catalogueFile;
  }

  private async decisions(fullnames: readonly string[]): Promise<ReadonlyMap<string, PostMirrorSourceDecision>> {
    if (this.gate === null) return new Map(fullnames.map(fullname => [fullname, 'allow'] as const));
    return await this.gate.decisions(fullnames);
  }

  private targetFlairId(sourceSubreddit: string, targetSubreddit: string, source: RedditPost): string | null {
    if (source.flairTemplateId === null && source.flairText === null) return null;
    if (source.flairTemplateId === null) {
      throw new Error(`Source post ${source.fullname} has visible flair but Reddit omitted its template UUID`);
    }
    if (this.flairs === null) throw new Error('Cross-community flair catalogue is unavailable');
    return this.flairs.targetTemplateId('post', sourceSubreddit, targetSubreddit, source.flairTemplateId);
  }

  private async reconcileFlairs(): Promise<void> {
    if (this.flairs !== null) return;
    this.flairs = await reconcileFlairCatalogue(
      this.catalogueFile,
      this.read,
      this.secondSubreddit,
      this.firstSubreddit,
    );
  }

  public async tick(now = Date.now()): Promise<PostMirrorTick> {
    await this.reconcileFlairs();
    const [firstPosts, secondPosts] = await Promise.all([
      this.read.newPosts(this.firstSubreddit, 100),
      this.read.newPosts(this.secondSubreddit, 100),
    ]);
    const observed: readonly ObservedPost[] = [
      ...firstPosts.map(post => ({ subreddit: this.firstSubreddit, targetSubreddit: this.secondSubreddit, post })),
      ...secondPosts.map(post => ({ subreddit: this.secondSubreddit, targetSubreddit: this.firstSubreddit, post })),
    ];

    if (!await this.store.seeded()) {
      await this.store.seed(observed.map(observedIdentity));
      return { seeded: true, discovered: 0, completed: 0, failed: 0 };
    }

    const byFullname = new Map(observed.map(item => [item.post.fullname, item] as const));
    const pendingBefore = await this.store.pending();
    const pendingByFullname = new Map(pendingBefore.map(item => [item.sourceFullname, item] as const));
    let completed = 0;

    const completeObservedPair = async (
      sourceKey: string,
      sourceFullname: string,
      target: ObservedPost,
    ): Promise<void> => {
      const targetKey = mirrorKey(target.subreddit, target.post.id);
      if (await this.store.counterpart(targetKey) !== null) return;
      await this.store.completePair(sourceKey, sourceFullname, targetKey, target.post.fullname);
      completed += 1;
    };

    for (const target of observed) {
      const parentFullname = target.post.crosspostParent;
      const fallback = fallbackOrigin(target.post.selfText);
      const sourceFullname = parentFullname ?? fallback?.fullname ?? null;
      if (sourceFullname === null) continue;

      const currentSource = byFullname.get(sourceFullname);
      if (currentSource !== undefined && !sameSubreddit(currentSource.subreddit, target.subreddit)) {
        if (fallback?.subreddit === null || fallback === null || sameSubreddit(fallback.subreddit, currentSource.subreddit)) {
          await completeObservedPair(
            mirrorKey(currentSource.subreddit, currentSource.post.id),
            currentSource.post.fullname,
            target,
          );
          continue;
        }
      }

      const pendingSource = pendingByFullname.get(sourceFullname);
      if (pendingSource !== undefined && sameSubreddit(pendingSource.targetSubreddit, target.subreddit)) {
        if (fallback?.subreddit === null || fallback === null || sameSubreddit(fallback.subreddit, pendingSource.sourceSubreddit)) {
          await completeObservedPair(pendingSource.key, pendingSource.sourceFullname, target);
          continue;
        }
      }

      const knownSourceKey = await this.store.knownKey(sourceFullname);
      if (knownSourceKey !== null) {
        const knownSubreddit = knownSourceKey.split(':', 1)[0] ?? '';
        if (!sameSubreddit(knownSubreddit, target.subreddit)) {
          if (fallback?.subreddit === null || fallback === null || sameSubreddit(fallback.subreddit, knownSubreddit)) {
            await completeObservedPair(knownSourceKey, sourceFullname, target);
          }
        }
      }
    }

    const pendingForGate = await this.store.pending();
    const decisions = await this.decisions([
      ...observed.map(item => item.post.fullname),
      ...pendingForGate.map(item => item.sourceFullname),
    ]);
    const discoverable = observed.filter(item => decisions.get(item.post.fullname) === 'allow');
    const discovered = await this.store.discover(discoverable.map(item => ({
      sourceSubreddit: item.subreddit,
      targetSubreddit: item.targetSubreddit,
      sourcePostId: item.post.id,
      sourceFullname: item.post.fullname,
      title: item.post.title,
      permalink: item.post.permalink,
      createdUtc: item.post.createdUtc,
      discoveredAt: now,
    })));

    const recentBySubreddit = new Map<string, readonly RedditPost[]>([
      [lower(this.firstSubreddit), firstPosts],
      [lower(this.secondSubreddit), secondPosts],
    ]);
    const pending = await this.store.pending();
    let failed = 0;

    for (const item of pending) {
      const decision = decisions.get(item.sourceFullname) ?? 'pending';
      if (decision === 'pending') continue;
      if (decision === 'deny') {
        await this.store.cancel(item.key);
        continue;
      }

      const claimed = await this.store.begin(item.key);
      if (claimed === null) continue;
      const targetRecent = recentBySubreddit.get(lower(claimed.targetSubreddit)) ?? [];
      const existing = targetRecent.find(post => {
        if (post.crosspostParent === claimed.sourceFullname) return true;
        const origin = fallbackOrigin(post.selfText);
        return origin !== null
          && origin.fullname === claimed.sourceFullname
          && (origin.subreddit === null || sameSubreddit(origin.subreddit, claimed.sourceSubreddit));
      });
      if (existing !== undefined) {
        await this.store.completePair(
          claimed.key,
          claimed.sourceFullname,
          mirrorKey(claimed.targetSubreddit, existing.id),
          existing.fullname,
        );
        completed += 1;
        continue;
      }

      try {
        const source = byFullname.get(claimed.sourceFullname)?.post ?? null;
        if (source === null) {
          throw new Error(`Source post ${claimed.sourceFullname} is no longer present in the observed Reddit listing`);
        }
        const flairId = this.targetFlairId(claimed.sourceSubreddit, claimed.targetSubreddit, source);
        const created = await this.write.crosspost(claimed.targetSubreddit, claimed.sourceFullname, claimed.title, flairId);
        await this.store.completePair(
          claimed.key,
          claimed.sourceFullname,
          mirrorKey(claimed.targetSubreddit, created.id),
          created.fullname,
        );
        completed += 1;
      } catch (crosspostError) {
        try {
          const source = byFullname.get(claimed.sourceFullname)?.post ?? null;
          if (source === null) {
            throw new Error(`Source post ${claimed.sourceFullname} is no longer present in the observed Reddit listing`);
          }
          const flairId = this.targetFlairId(claimed.sourceSubreddit, claimed.targetSubreddit, source);
          const created = await this.write.submitSelf(claimed.targetSubreddit, claimed.title, fallbackBody(claimed), flairId);
          await this.store.completePair(
            claimed.key,
            claimed.sourceFullname,
            mirrorKey(claimed.targetSubreddit, created.id),
            created.fullname,
          );
          completed += 1;
          console.error(`[Reddit post mirror] native crosspost failed for ${claimed.sourceFullname}; fallback used: ${safeError(crosspostError)}`);
        } catch (fallbackError) {
          const message = `crosspost=${safeError(crosspostError)}; fallback=${safeError(fallbackError)}`;
          await this.store.failed(claimed.key, message);
          failed += 1;
          console.error(`[Reddit post mirror] failed for ${claimed.sourceFullname}: ${message}`);
        }
      }
    }

    return { seeded: false, discovered, completed, failed };
  }
}
