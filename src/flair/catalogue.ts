import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { RedditFlairTemplate } from '../reddit/types.ts';
import { parseMap, type JsonMap } from '../types/json.ts';

export type FlairKind = 'user' | 'post';

export type FlairCatalogueReader = {
  userFlairTemplates(subreddit: string): Promise<readonly RedditFlairTemplate[]>;
  postFlairTemplates(subreddit: string): Promise<readonly RedditFlairTemplate[]>;
};

export type FlairCatalogueResolver = {
  targetTemplateId(
    kind: FlairKind,
    sourceSubreddit: string,
    targetSubreddit: string,
    sourceTemplateId: string,
  ): string;
};

type FlairMapping = {
  readonly kind: FlairKind;
  readonly sourceTemplateId: string;
  readonly targetTemplateId: string;
  readonly text: string;
  readonly cssClass: string | null;
};

const norm = (value: string | null): string => value ?? '';
const lower = (value: string): string => value.trim().toLowerCase();

const samePresentation = (left: RedditFlairTemplate, right: RedditFlairTemplate): boolean =>
  left.text === right.text
  && norm(left.cssClass) === norm(right.cssClass)
  && norm(left.textColour) === norm(right.textColour)
  && norm(left.backgroundColour) === norm(right.backgroundColour)
  && left.modOnly === right.modOnly
  && left.textEditable === right.textEditable
  && norm(left.allowableContent) === norm(right.allowableContent)
  && (left.maxEmojis ?? 0) === (right.maxEmojis ?? 0);

const completeMappings = (
  kind: FlairKind,
  sourceTemplates: readonly RedditFlairTemplate[],
  targetTemplates: readonly RedditFlairTemplate[],
): readonly FlairMapping[] => {
  const mappings = sourceTemplates.map(source => {
    const matches = targetTemplates.filter(target => samePresentation(source, target));
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one r/target equivalent for ${kind} flair ${source.id} (${JSON.stringify(source.text)}), found ${matches.length}`,
      );
    }
    const target = matches[0];
    if (target === undefined) throw new Error(`Resolved ${kind} flair destination disappeared for ${source.id}`);
    return {
      kind,
      sourceTemplateId: source.id,
      targetTemplateId: target.id,
      text: source.text,
      cssClass: source.cssClass,
    };
  });

  for (const target of targetTemplates) {
    const matches = sourceTemplates.filter(source => samePresentation(source, target));
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one r/source equivalent for ${kind} flair ${target.id} (${JSON.stringify(target.text)}), found ${matches.length}`,
      );
    }
  }

  if (new Set(mappings.map(item => item.sourceTemplateId)).size !== sourceTemplates.length) {
    throw new Error(`Duplicate source UUID detected while mapping ${kind} flairs`);
  }
  if (new Set(mappings.map(item => item.targetTemplateId)).size !== targetTemplates.length) {
    throw new Error(`Cross-community ${kind} flair mapping is not one-to-one`);
  }
  return mappings;
};

const existingCatalogue = async (file: string): Promise<JsonMap> => {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {};
    throw error;
  }
  return parseMap(raw);
};

class PersistedFlairCatalogue implements FlairCatalogueResolver {
  private readonly forward = new Map<string, string>();
  private readonly reverse = new Map<string, string>();

  public constructor(
    private readonly sourceSubreddit: string,
    private readonly targetSubreddit: string,
    userMappings: readonly FlairMapping[],
    postMappings: readonly FlairMapping[],
  ) {
    for (const mapping of [...userMappings, ...postMappings]) {
      const prefix = `${mapping.kind}\n`;
      this.forward.set(`${prefix}${mapping.sourceTemplateId}`, mapping.targetTemplateId);
      this.reverse.set(`${prefix}${mapping.targetTemplateId}`, mapping.sourceTemplateId);
    }
  }

  public targetTemplateId(
    kind: FlairKind,
    sourceSubreddit: string,
    targetSubreddit: string,
    sourceTemplateId: string,
  ): string {
    const source = lower(sourceSubreddit);
    const target = lower(targetSubreddit);
    const canonicalSource = lower(this.sourceSubreddit);
    const canonicalTarget = lower(this.targetSubreddit);
    const key = `${kind}\n${sourceTemplateId}`;

    if (source === canonicalSource && target === canonicalTarget) {
      const mapped = this.forward.get(key);
      if (mapped === undefined) throw new Error(`No persisted ${kind} flair mapping for source template ${sourceTemplateId}`);
      return mapped;
    }
    if (source === canonicalTarget && target === canonicalSource) {
      const mapped = this.reverse.get(key);
      if (mapped === undefined) throw new Error(`No persisted ${kind} flair mapping for target template ${sourceTemplateId}`);
      return mapped;
    }
    throw new Error(`Flair catalogue does not map r/${sourceSubreddit} -> r/${targetSubreddit}`);
  }
}

export const reconcileFlairCatalogue = async (
  file: string,
  read: FlairCatalogueReader,
  sourceSubreddit: string,
  targetSubreddit: string,
): Promise<FlairCatalogueResolver> => {
  const [sourceUsers, sourcePosts, targetUsers, targetPosts] = await Promise.all([
    read.userFlairTemplates(sourceSubreddit),
    read.postFlairTemplates(sourceSubreddit),
    read.userFlairTemplates(targetSubreddit),
    read.postFlairTemplates(targetSubreddit),
  ]);

  const userMappings = completeMappings('user', sourceUsers, targetUsers);
  const postMappings = completeMappings('post', sourcePosts, targetPosts);
  const existing = await existingCatalogue(file);
  const catalogue = parseMap(JSON.stringify({
    ...existing,
    schema: 2,
    generatedAt: new Date().toISOString(),
    sourceSubreddit,
    targetSubreddit,
    userTemplates: {
      source: sourceUsers,
      target: targetUsers,
      mapping: userMappings,
    },
    postTemplates: {
      source: sourcePosts,
      target: targetPosts,
      mapping: postMappings,
    },
  }));

  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.tmp.${process.pid}`;
  await writeFile(temp, `${JSON.stringify(catalogue, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, file);

  return new PersistedFlairCatalogue(
    sourceSubreddit,
    targetSubreddit,
    userMappings,
    postMappings,
  );
};
