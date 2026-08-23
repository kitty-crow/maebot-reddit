import type { Tweet } from '../../vendor/maebot-twitter/src/index.ts';
import type { RedditCfg } from '../env.ts';
import { RedditReadClient } from '../reddit/client.ts';
import { RedditMutationClient } from '../reddit/mutate.ts';
import { readStickySlots } from '../reddit/stickySlots.ts';
import { twitterAnnouncementFlair } from './flair.ts';
import { renderLegacyFallback, renderTweetForReddit } from './render.ts';
import { planSticky } from './sticky.ts';
import type { RedditLegacyPost, RedditPrimaryPost, TwitterRedditPublisher } from './bridge.ts';

const redditPostUrl = (subreddit: string, postId: string): string =>
  `https://www.reddit.com/r/${subreddit}/comments/${postId}`;

export class LiveTwitterRedditPublisher implements TwitterRedditPublisher {
  private readonly read: RedditReadClient;
  private readonly write: RedditMutationClient;
  private readonly flairIds = new Map<string, string>();

  public constructor(private readonly cfg: RedditCfg) {
    this.read = new RedditReadClient(cfg.auth);
    this.write = new RedditMutationClient(cfg.auth);
  }

  public async publishPrimary(tweet: Tweet, worthy: boolean | null): Promise<RedditPrimaryPost> {
    const rendered = renderTweetForReddit(tweet);
    const flairId = await this.flairId(this.cfg.primarySubreddit, worthy);
    const created = await this.write.submitSelf(this.cfg.primarySubreddit, rendered.title, rendered.body, flairId);
    return { postId: created.id };
  }

  public async publishLegacy(
    tweet: Tweet,
    primaryPostId: string,
    worthy: boolean | null,
  ): Promise<RedditLegacyPost> {
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

    const flairId = await this.flairId(this.cfg.sourceSubreddit, worthy);
    const title = renderTweetForReddit(tweet).title;
    try {
      const created = await this.write.crosspost(this.cfg.sourceSubreddit, primaryPostId, title, flairId);
      return { postId: created.id, mode: 'crosspost' };
    } catch (crosspostError) {
      console.error(`[Reddit Twitter publisher] native crosspost failed; using self-post fallback: ${String(crosspostError)}`);
      const fallback = renderLegacyFallback(tweet, primaryUrl);
      const created = await this.write.submitSelf(this.cfg.sourceSubreddit, fallback.title, fallback.body, flairId);
      return { postId: created.id, mode: 'fallback' };
    }
  }

  public async pin(target: 'primary' | 'legacy', postId: string): Promise<void> {
    const subreddit = target === 'primary' ? this.cfg.primarySubreddit : this.cfg.sourceSubreddit;
    const slots = await readStickySlots(this.read, subreddit);
    const plan = planSticky(slots, postId);
    if (plan.action === 'already_sticky') return;
    if (plan.action === 'blocked') {
      throw new Error(`All four API-visible highlight slots in r/${subreddit} are occupied; refusing to evict an unrelated post`);
    }
    await this.write.sticky(postId, plan.slot);
  }

  private async flairId(subreddit: string, worthy: boolean | null): Promise<string> {
    const flairText = twitterAnnouncementFlair(worthy);
    const key = `${subreddit.toLowerCase()}\n${flairText}`;
    const cached = this.flairIds.get(key);
    if (cached !== undefined) return cached;

    const matches = (await this.read.postFlairTemplates(subreddit)).filter(template => template.text === flairText);
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one post flair ${JSON.stringify(flairText)} in r/${subreddit}, found ${matches.length}`);
    }
    const match = matches[0];
    if (match === undefined) throw new Error(`Resolved post flair ${JSON.stringify(flairText)} disappeared in r/${subreddit}`);
    this.flairIds.set(key, match.id);
    return match.id;
  }
}
