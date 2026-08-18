import type { Tweet } from '../../vendor/maebot-twitter/src/index.ts';
import type { RedditCfg } from '../env.ts';
import { RedditReadClient } from '../reddit/client.ts';
import { RedditMutationClient } from '../reddit/mutate.ts';
import { readStickySlots } from '../reddit/stickySlots.ts';
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
    const primaryFullname = primaryPostId.startsWith('t3_') ? primaryPostId : `t3_${primaryPostId}`;
    const primaryUrl = redditPostUrl(this.cfg.primarySubreddit, primaryPostId);
    const existing = (await this.read.newPosts(this.cfg.sourceSubreddit, 100)).find(post =>
      post.crosspostParent === primaryFullname
      || post.selfText.includes(`mae-mirror:v2:${this.cfg.primarySubreddit}:${primaryFullname}`)
      || post.selfText.includes(`mae-mirror:${primaryFullname}`)
      || post.selfText.includes(`Primary Reddit post: ${primaryUrl}`));
    if (existing !== undefined) {
      return {
        postId: existing.id,
        mode: existing.crosspostParent === primaryFullname ? 'crosspost' : 'fallback',
      };
    }

    const title = renderTweetForReddit(tweet).title;
    try {
      const created = await this.write.crosspost(this.cfg.sourceSubreddit, primaryPostId, title);
      return { postId: created.id, mode: 'crosspost' };
    } catch (crosspostError) {
      console.error(`[Reddit Twitter publisher] native crosspost failed; using self-post fallback: ${String(crosspostError)}`);
      const fallback = renderLegacyFallback(tweet, primaryUrl);
      const created = await this.write.submitSelf(this.cfg.sourceSubreddit, fallback.title, fallback.body);
      return { postId: created.id, mode: 'fallback' };
    }
  }

  public async pin(target: 'primary' | 'legacy', postId: string): Promise<void> {
    const subreddit = target === 'primary' ? this.cfg.primarySubreddit : this.cfg.sourceSubreddit;
    const [first, second] = await readStickySlots(this.read, subreddit);
    const plan = planSticky([first, second], postId);
    if (plan.action === 'already_sticky') return;
    if (plan.action === 'blocked') {
      throw new Error(`Both sticky slots in r/${subreddit} are occupied; refusing to evict an unrelated post`);
    }
    await this.write.sticky(postId, plan.slot);
  }
}
