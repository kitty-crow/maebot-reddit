import type { Tweet } from '../../vendor/maebot-twitter/src/index.ts';
import type { RedditCfg } from '../env.ts';
import { RedditReadClient } from '../reddit/client.ts';
import { RedditMutationClient } from '../reddit/mutate.ts';
import { renderLegacyFallback, renderTweetForReddit } from './render.ts';
import { planSticky } from './sticky.ts';
import type { RedditLegacyPost, RedditPrimaryPost, TwitterRedditPublisher } from './bridge.ts';

const redditPostUrl = (subreddit: string, postId: string): string =>
  `https://www.reddit.com/r/${subreddit}/comments/${postId}`;

export class LiveTwitterRedditPublisher implements TwitterRedditPublisher {
  private readonly read: RedditReadClient;
  private readonly write: RedditMutationClient;

  public constructor(private readonly cfg: RedditCfg) {
    this.read = new RedditReadClient(cfg.auth);
    this.write = new RedditMutationClient(cfg.auth);
  }

  public async publishPrimary(tweet: Tweet): Promise<RedditPrimaryPost> {
    const rendered = renderTweetForReddit(tweet);
    const created = await this.write.submitSelf(this.cfg.primarySubreddit, rendered.title, rendered.body);
    return { postId: created.id };
  }

  public async publishLegacy(tweet: Tweet, primaryPostId: string): Promise<RedditLegacyPost> {
    const title = renderTweetForReddit(tweet).title;
    try {
      const created = await this.write.crosspost(this.cfg.sourceSubreddit, primaryPostId, title);
      return { postId: created.id, mode: 'crosspost' };
    } catch (crosspostError) {
      console.error(`[Reddit Twitter publisher] native crosspost failed; using self-post fallback: ${String(crosspostError)}`);
      const fallback = renderLegacyFallback(tweet, redditPostUrl(this.cfg.primarySubreddit, primaryPostId));
      const created = await this.write.submitSelf(this.cfg.sourceSubreddit, fallback.title, fallback.body);
      return { postId: created.id, mode: 'fallback' };
    }
  }

  public async pin(target: 'primary' | 'legacy', postId: string): Promise<void> {
    const subreddit = target === 'primary' ? this.cfg.primarySubreddit : this.cfg.sourceSubreddit;
    const stickies = await Promise.all([
      this.read.sticky(subreddit, 1),
      this.read.sticky(subreddit, 2),
    ]) as [Awaited<ReturnType<RedditReadClient['sticky']>>, Awaited<ReturnType<RedditReadClient['sticky']>>];
    const plan = planSticky(stickies, postId);
    if (plan.action === 'already_sticky') return;
    if (plan.action === 'blocked') {
      throw new Error(`Both sticky slots in r/${subreddit} are occupied; refusing to evict an unrelated post`);
    }
    await this.write.sticky(postId, plan.slot);
  }
}
