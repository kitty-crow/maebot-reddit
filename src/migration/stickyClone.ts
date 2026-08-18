import type { RedditCreatedPost } from '../reddit/mutate.ts';
import { readStickySlots } from '../reddit/stickySlots.ts';
import type { RedditFlairTemplate, RedditPost } from '../reddit/types.ts';

export type StickyCloneReader = {
  hotPosts(subreddit: string, limit?: number): Promise<readonly RedditPost[]>;
  newPosts(subreddit: string, limit?: number): Promise<readonly RedditPost[]>;
};

export type StickyCloneWriter = {
  crosspost(subreddit: string, sourcePostId: string, title: string): Promise<RedditCreatedPost>;
  submitSelf(subreddit: string, title: string, body: string): Promise<RedditCreatedPost>;
  setPostFlairTemplate(subreddit: string, postId: string, templateId: string, customText?: string | null): Promise<void>;
  sticky(postId: string, slot: 1 | 2): Promise<void>;
};

export type StickyFlairMapping = {
  readonly sourceTemplateId: string;
  readonly targetTemplateId: string;
};

export type StickyCloneRecord = {
  readonly slot: 1 | 2;
  readonly sourcePostId: string;
  readonly sourceFullname: string;
  readonly sourceTitle: string;
  readonly sourceFlairTemplateId: string | null;
  readonly sourceFlairText: string | null;
  readonly targetPostId: string;
  readonly targetFlairTemplateId: string | null;
  readonly mode: 'crosspost' | 'fallback' | 'existing';
};

const marker = (sourceFullname: string): string => `<!-- mae-sticky-clone:${sourceFullname} -->`;
const sourceUrl = (post: RedditPost): string => post.permalink.startsWith('http')
  ? post.permalink
  : `https://www.reddit.com${post.permalink.startsWith('/') ? '' : '/'}${post.permalink}`;

const fallbackBody = (sourceSubreddit: string, post: RedditPost): string => {
  const copiedBody = post.selfText.trim();
  const prefix = `Migrated from r/${sourceSubreddit}.\n\n[Open the original post](${sourceUrl(post)})`;
  return `${prefix}${copiedBody.length === 0 ? '' : `\n\n${copiedBody}`}\n\n${marker(post.fullname)}`;
};

const sourceTemplateFor = (
  post: RedditPost,
  sourceTemplates: readonly RedditFlairTemplate[],
): RedditFlairTemplate | null => {
  if (post.flairTemplateId !== null) {
    return sourceTemplates.find(template => template.id === post.flairTemplateId) ?? null;
  }
  if (post.flairText === null) return null;
  const matches = sourceTemplates.filter(template => template.text === post.flairText);
  return matches.length === 1 ? matches[0] ?? null : null;
};

export const cloneStickyPosts = async (
  read: StickyCloneReader,
  write: StickyCloneWriter,
  sourceSubreddit: string,
  targetSubreddit: string,
  sourcePostTemplates: readonly RedditFlairTemplate[],
  targetPostTemplates: readonly RedditFlairTemplate[],
  flairMappings: readonly StickyFlairMapping[],
): Promise<readonly StickyCloneRecord[]> => {
  const sourceSlots = await readStickySlots(read, sourceSubreddit);
  const targetRecent = await read.newPosts(targetSubreddit, 100);
  const mappingBySource = new Map(flairMappings.map(mapping => [mapping.sourceTemplateId, mapping.targetTemplateId]));
  const targetTemplateById = new Map(targetPostTemplates.map(template => [template.id, template]));
  const records: StickyCloneRecord[] = [];

  for (const slot of [1, 2] as const) {
    const source = sourceSlots[slot - 1];
    if (source === null) continue;

    const existing = targetRecent.find(post =>
      post.crosspostParent === source.fullname || post.selfText.includes(marker(source.fullname)));

    let targetPostId: string;
    let mode: StickyCloneRecord['mode'];
    if (existing !== undefined) {
      targetPostId = existing.id;
      mode = 'existing';
    } else {
      try {
        const created = await write.crosspost(targetSubreddit, source.fullname, source.title);
        targetPostId = created.id;
        mode = 'crosspost';
      } catch {
        const created = await write.submitSelf(targetSubreddit, source.title, fallbackBody(sourceSubreddit, source));
        targetPostId = created.id;
        mode = 'fallback';
      }
    }

    const sourceTemplate = sourceTemplateFor(source, sourcePostTemplates);
    let targetFlairTemplateId: string | null = null;
    if (source.flairTemplateId !== null || source.flairText !== null) {
      if (sourceTemplate === null) {
        throw new Error(`Could not resolve source post flair for sticky ${source.fullname}`);
      }
      const mappedId = mappingBySource.get(sourceTemplate.id);
      if (mappedId === undefined) {
        throw new Error(`No destination post flair mapping for sticky ${source.fullname} template ${sourceTemplate.id}`);
      }
      const targetTemplate = targetTemplateById.get(mappedId);
      if (targetTemplate === undefined) {
        throw new Error(`Mapped destination post flair ${mappedId} disappeared for sticky ${source.fullname}`);
      }
      const customText = targetTemplate.textEditable ? source.flairText : null;
      await write.setPostFlairTemplate(targetSubreddit, targetPostId, mappedId, customText);
      targetFlairTemplateId = mappedId;
    }

    await write.sticky(targetPostId, slot);
    records.push({
      slot,
      sourcePostId: source.id,
      sourceFullname: source.fullname,
      sourceTitle: source.title,
      sourceFlairTemplateId: source.flairTemplateId,
      sourceFlairText: source.flairText,
      targetPostId,
      targetFlairTemplateId,
      mode,
    });
  }

  return records;
};
