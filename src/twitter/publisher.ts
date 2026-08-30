import {
  downloadTwitterMedia,
  twitterMediaUrls,
  type Tweet,
} from '../../vendor/maebot-twitter/src/index.ts';
import type { RedditAuthCfg, RedditCfg } from '../env.ts';
import { RedditReadClient } from '../reddit/client.ts';
import { RedditMediaClient, type RedditGalleryMedia } from '../reddit/media.ts';
import { RedditMutationClient } from '../reddit/mutate.ts';
import { readStickySlots } from '../reddit/stickySlots.ts';
import { twitterAnnouncementFlair } from './flair.ts';
import {
  redditAnnouncementAuth,
  twitterRedditPublishingIdentity,
} from './publishingAuth.ts';
import { renderTweetForReddit } from './render.ts';
import { planSticky } from './sticky.ts';
import type { RedditLegacyPost, RedditPrimaryPost, TwitterRedditPublisher } from './bridge.ts';

export class LiveTwitterRedditPublisher implements TwitterRedditPublisher {
  private readonly read: RedditReadClient;
  private readonly maeWrite: RedditMutationClient;
  private readonly announcementWrite: RedditMutationClient;
  private readonly maeMedia: RedditMediaClient;
  private readonly announcementMedia: RedditMediaClient;
  private readonly flairIds = new Map<string, string>();

  public constructor(
    private readonly cfg: RedditCfg,
    announcementAuth: RedditAuthCfg = redditAnnouncementAuth(cfg.auth),
  ) {
    this.read = new RedditReadClient(cfg.auth);
    this.maeWrite = new RedditMutationClient(cfg.auth);
    this.announcementWrite = new RedditMutationClient(announcementAuth);
    this.maeMedia = new RedditMediaClient(cfg.auth);
    this.announcementMedia = new RedditMediaClient(announcementAuth);
  }

  public async publishPrimary(tweet: Tweet, worthy: boolean | null): Promise<RedditPrimaryPost> {
    const flairId = await this.flairId(this.cfg.primarySubreddit, worthy);
    return { postId: await this.publishTweet(this.cfg.primarySubreddit, tweet, worthy, flairId) };
  }

  public async publishLegacy(
    tweet: Tweet,
    primaryPostId: string,
    worthy: boolean | null,
  ): Promise<RedditLegacyPost> {
    const primaryFullname = primaryPostId.startsWith('t3_') ? primaryPostId : `t3_${primaryPostId}`;
    const expectedTitle = renderTweetForReddit(tweet, worthy === true).title;
    const existing = (await this.read.newPosts(this.cfg.sourceSubreddit, 100)).find(post =>
      post.crosspostParent === primaryFullname
      || post.selfText.includes(`mae-mirror:v2:${this.cfg.primarySubreddit}:${primaryFullname}`)
      || post.selfText.includes(`mae-mirror:${primaryFullname}`)
      || post.title === expectedTitle);
    if (existing !== undefined) {
      return {
        postId: existing.id,
        mode: existing.crosspostParent === primaryFullname ? 'crosspost' : 'fallback',
      };
    }

    const flairId = await this.flairId(this.cfg.sourceSubreddit, worthy);
    const postId = await this.publishTweet(this.cfg.sourceSubreddit, tweet, worthy, flairId);
    return { postId, mode: 'fallback' };
  }

  public async pin(target: 'primary' | 'legacy', postId: string): Promise<void> {
    const subreddit = target === 'primary' ? this.cfg.primarySubreddit : this.cfg.sourceSubreddit;
    const [first, second] = await readStickySlots(this.read, subreddit);
    const plan = planSticky([first, second], postId);
    if (plan.action === 'already_sticky') return;
    if (plan.action === 'blocked') {
      throw new Error(`Both sticky slots in r/${subreddit} are occupied; refusing to evict an unrelated post`);
    }
    await this.maeWrite.sticky(postId, plan.slot);
  }

  private async publishTweet(
    subreddit: string,
    tweet: Tweet,
    worthy: boolean | null,
    flairId: string,
    overrideTitle: string | null = null,
    overrideBody: string | null = null,
  ): Promise<string> {
    const rendered = renderTweetForReddit(tweet, worthy === true);
    const title = overrideTitle ?? rendered.title;
    const body = overrideBody ?? rendered.body;
    const urls = twitterMediaUrls(tweet);
    if (urls.length === 0) {
      return (await this.writer(worthy).submitSelf(subreddit, title, body, flairId)).id;
    }

    const media = this.media(worthy);
    if (urls.length === 1) {
      const downloaded = await downloadTwitterMedia(urls[0] ?? '');
      let videoPosterUrl: string | null = null;
      if (downloaded.contentType === 'video/mp4') {
        const avatar = tweet.author.avatar;
        if (avatar === null || avatar.length === 0) {
          throw new Error(`Tweet ${tweet.id} author avatar is unavailable for Reddit video poster upload`);
        }
        const poster = await downloadTwitterMedia(avatar);
        if (!poster.contentType.startsWith('image/')) {
          throw new Error(`Tweet ${tweet.id} author avatar is not an image`);
        }
        videoPosterUrl = await media.uploadMedia(
          `tweet-${tweet.id}-poster.${poster.extension}`,
          poster.contentType,
          poster.bytes,
        );
      }
      const created = await media.submitMedia(
        subreddit,
        title,
        body,
        flairId,
        `tweet-${tweet.id}.${downloaded.extension}`,
        downloaded.contentType,
        downloaded.bytes,
        videoPosterUrl,
      );
      return created.id;
    }

    const gallery: RedditGalleryMedia[] = [];
    for (const [index, url] of urls.entries()) {
      const downloaded = await downloadTwitterMedia(url);
      if (!downloaded.contentType.startsWith('image/')) {
        throw new Error(`Tweet ${tweet.id} contains multiple media items including non-image media`);
      }
      gallery.push({
        name: `tweet-${tweet.id}-${index + 1}.${downloaded.extension}`,
        mimeType: downloaded.contentType,
        bytes: downloaded.bytes,
      });
    }
    return (await media.submitGallery(subreddit, title, flairId, gallery)).id;
  }

  private writer(worthy: boolean | null): RedditMutationClient {
    return twitterRedditPublishingIdentity(worthy) === 'announcement'
      ? this.announcementWrite
      : this.maeWrite;
  }

  private media(worthy: boolean | null): RedditMediaClient {
    return twitterRedditPublishingIdentity(worthy) === 'announcement'
      ? this.announcementMedia
      : this.maeMedia;
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
