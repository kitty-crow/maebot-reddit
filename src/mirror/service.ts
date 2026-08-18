import type { RedditPost } from '../reddit/types.ts';
import type { RedditCreatedPost } from '../reddit/mutate.ts';
import { PostMirrorStore, type MirrorRecord } from './store.ts';

export type MirrorReader = { newPosts(subreddit: string, limit?: number): Promise<readonly RedditPost[]> };
export type MirrorWriter = {
  crosspost(subreddit: string, sourcePostId: string, title: string): Promise<RedditCreatedPost>;
  submitSelf(subreddit: string, title: string, body: string): Promise<RedditCreatedPost>;
};
export type PostMirrorTick = { seeded: boolean; discovered: number; completed: number; failed: number };

const tag = (fullname: string): string => `<!-- mae-mirror:${fullname} -->`;
const sourceUrl = (permalink: string): string => permalink.startsWith('http')
  ? permalink
  : `https://www.reddit.com${permalink.startsWith('/') ? '' : '/'}${permalink}`;
const fallbackBody = (item: MirrorRecord): string =>
  `Mirrored from r/nyaonearth.\n\n[Open the original post](${sourceUrl(item.permalink)})\n\n${tag(item.sourceFullname)}`;
const safeError = (error: unknown): string => error instanceof Error ? error.message : String(error);

export class PrimaryPostMirror {
  public constructor(
    private readonly read: MirrorReader,
    private readonly write: MirrorWriter,
    private readonly store: PostMirrorStore,
    private readonly primarySubreddit: string,
    private readonly legacySubreddit: string,
  ) {}

  public async tick(now = Date.now()): Promise<PostMirrorTick> {
    const primary = await this.read.newPosts(this.primarySubreddit, 100);
    if (!await this.store.seeded()) {
      await this.store.seed(primary.map(post => post.id));
      return { seeded: true, discovered: 0, completed: 0, failed: 0 };
    }

    const discovered = await this.store.discover(primary.map(post => ({
      sourcePostId: post.id,
      sourceFullname: post.fullname,
      title: post.title,
      permalink: post.permalink,
      createdUtc: post.createdUtc,
      discoveredAt: now,
    })));
    const pending = await this.store.pending();
    if (pending.length === 0) return { seeded: false, discovered, completed: 0, failed: 0 };

    const legacyRecent = await this.read.newPosts(this.legacySubreddit, 100);
    let completed = 0;
    let failed = 0;
    for (const item of pending) {
      const claimed = await this.store.begin(item.sourcePostId);
      if (claimed === null) continue;
      const existing = legacyRecent.find(post =>
        post.crosspostParent === claimed.sourceFullname || post.selfText.includes(tag(claimed.sourceFullname)));
      if (existing !== undefined) {
        await this.store.applied(claimed.sourcePostId, existing.id, 'existing', now);
        completed += 1;
        continue;
      }
      try {
        const created = await this.write.crosspost(this.legacySubreddit, claimed.sourceFullname, claimed.title);
        await this.store.applied(claimed.sourcePostId, created.id, 'crosspost', now);
        completed += 1;
      } catch (crosspostError) {
        try {
          const created = await this.write.submitSelf(this.legacySubreddit, claimed.title, fallbackBody(claimed));
          await this.store.applied(claimed.sourcePostId, created.id, 'fallback', now);
          completed += 1;
          console.error(`[Reddit post mirror] native crosspost failed for ${claimed.sourceFullname}; fallback used: ${safeError(crosspostError)}`);
        } catch (fallbackError) {
          const message = `crosspost=${safeError(crosspostError)}; fallback=${safeError(fallbackError)}`;
          await this.store.failed(claimed.sourcePostId, message);
          failed += 1;
          console.error(`[Reddit post mirror] failed for ${claimed.sourceFullname}: ${message}`);
        }
      }
    }
    return { seeded: false, discovered, completed, failed };
  }
}
