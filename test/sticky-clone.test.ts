import { describe, expect, test } from 'bun:test';
import { cloneStickyPosts, type StickyCloneReader, type StickyCloneWriter } from '../src/migration/stickyClone.ts';
import type { RedditCreatedPost } from '../src/reddit/mutate.ts';
import type { RedditFlairTemplate, RedditPost } from '../src/reddit/types.ts';

const template = (id: string, text: string, textEditable = false): RedditFlairTemplate => ({
  id,
  text,
  cssClass: null,
  textColour: null,
  backgroundColour: null,
  modOnly: false,
  textEditable,
  allowableContent: null,
  maxEmojis: null,
});

const post = (
  id: string,
  subreddit: string,
  options: {
    readonly stickied?: boolean;
    readonly flairTemplateId?: string | null;
    readonly flairText?: string | null;
    readonly crosspostParent?: string | null;
    readonly selfText?: string;
  } = {},
): RedditPost => ({
  id,
  fullname: `t3_${id}`,
  subreddit,
  title: `Post ${id}`,
  author: 'member',
  permalink: `/r/${subreddit}/comments/${id}/post_${id}/`,
  createdUtc: 1,
  selfText: options.selfText ?? '',
  url: `https://www.reddit.com/r/${subreddit}/comments/${id}/post_${id}/`,
  flairTemplateId: options.flairTemplateId ?? null,
  flairText: options.flairText ?? null,
  stickied: options.stickied ?? false,
  locked: false,
  over18: false,
  crosspostParent: options.crosspostParent ?? null,
  score: 0,
  mediaUrls: [],
});

describe('sticky post migration', () => {
  test('crossposts source stickies, maps their post flairs and pins the matching slots', async () => {
    const sourceTemplate = template('source-flair', 'Announcement', true);
    const targetTemplate = template('target-flair', 'Announcement', true);
    const first = post('source-one', 'catgirlcoin', {
      stickied: true,
      flairTemplateId: sourceTemplate.id,
      flairText: 'Important announcement',
    });
    const second = post('source-two', 'catgirlcoin', { stickied: true });

    const reader: StickyCloneReader = {
      hotPosts: async subreddit => subreddit === 'catgirlcoin' ? [first, second] : [],
      newPosts: async () => [],
    };
    const crossposts: string[] = [];
    const flairs: { postId: string; templateId: string; text: string | null | undefined }[] = [];
    const pins: { postId: string; slot: number }[] = [];
    const writer: StickyCloneWriter = {
      crosspost: async (_subreddit, sourcePostId): Promise<RedditCreatedPost> => {
        crossposts.push(sourcePostId);
        const id = `copy-${crossposts.length}`;
        return { id, fullname: `t3_${id}`, url: '' };
      },
      submitSelf: async () => { throw new Error('fallback not expected'); },
      setPostFlairTemplate: async (_subreddit, postId, templateId, text) => {
        flairs.push({ postId, templateId, text });
      },
      sticky: async (postId, slot) => { pins.push({ postId, slot }); },
    };

    const result = await cloneStickyPosts(
      reader,
      writer,
      'catgirlcoin',
      'nyaonearth',
      [sourceTemplate],
      [targetTemplate],
      [{ sourceTemplateId: sourceTemplate.id, targetTemplateId: targetTemplate.id }],
    );

    expect(crossposts).toEqual(['t3_source-one', 't3_source-two']);
    expect(flairs).toEqual([{ postId: 'copy-1', templateId: 'target-flair', text: 'Important announcement' }]);
    expect(pins).toEqual([{ postId: 'copy-1', slot: 1 }, { postId: 'copy-2', slot: 2 }]);
    expect(result.map(item => item.mode)).toEqual(['crosspost', 'crosspost']);
  });

  test('reuses an already-crossposted sticky instead of duplicating it', async () => {
    const source = post('source-one', 'catgirlcoin', { stickied: true });
    const existing = post('existing-target', 'nyaonearth', { crosspostParent: source.fullname });
    let writes = 0;
    const reader: StickyCloneReader = {
      hotPosts: async subreddit => subreddit === 'catgirlcoin' ? [source] : [],
      newPosts: async () => [existing],
    };
    const writer: StickyCloneWriter = {
      crosspost: async () => { writes += 1; throw new Error('unexpected'); },
      submitSelf: async () => { writes += 1; throw new Error('unexpected'); },
      setPostFlairTemplate: async () => { writes += 1; },
      sticky: async () => undefined,
    };

    const result = await cloneStickyPosts(reader, writer, 'catgirlcoin', 'nyaonearth', [], [], []);
    expect(writes).toBe(0);
    expect(result).toHaveLength(1);
    expect(result[0]?.mode).toBe('existing');
    expect(result[0]?.targetPostId).toBe('existing-target');
  });
});
