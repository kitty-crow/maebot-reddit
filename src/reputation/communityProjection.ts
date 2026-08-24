import { readFile } from 'node:fs/promises';
import type { RedditFlairAssignment } from '../reddit/types.ts';
import { isMap, parseMap, type Json } from '../types/json.ts';

export type CommunityFlairRestore = {
  readonly username: string;
  readonly templateId: string;
  readonly customText: string | null;
};

const normalise = (value: string): string => value.trim().toLowerCase();
const text = (value: Json | undefined): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;
const bool = (value: Json | undefined): boolean => value === true;

const catalogueMapping = (
  catalogue: Json,
): {
  readonly sourceSubreddit: string;
  readonly targetSubreddit: string;
  readonly templateIds: ReadonlyMap<string, string>;
  readonly editableTargets: ReadonlySet<string>;
} => {
  if (!isMap(catalogue)) throw new Error('Flair projection catalogue root must be an object');
  const sourceSubreddit = text(catalogue['sourceSubreddit']);
  const targetSubreddit = text(catalogue['targetSubreddit']);
  const userTemplates = catalogue['userTemplates'];
  if (sourceSubreddit === null || targetSubreddit === null || !isMap(userTemplates)) {
    throw new Error('Flair projection catalogue is incomplete');
  }

  const mapping = userTemplates['mapping'];
  const targets = userTemplates['target'];
  if (!Array.isArray(mapping) || !Array.isArray(targets)) {
    throw new Error('Flair projection catalogue user template inventory is incomplete');
  }

  const templateIds = new Map<string, string>();
  for (const raw of mapping) {
    if (!isMap(raw)) continue;
    const sourceTemplateId = text(raw['sourceTemplateId']);
    const targetTemplateId = text(raw['targetTemplateId']);
    if (sourceTemplateId === null || targetTemplateId === null) continue;
    if (templateIds.has(sourceTemplateId)) {
      throw new Error(`Duplicate flair projection mapping for source template ${sourceTemplateId}`);
    }
    templateIds.set(sourceTemplateId, targetTemplateId);
  }

  const editableTargets = new Set<string>();
  for (const raw of targets) {
    if (!isMap(raw)) continue;
    const id = text(raw['id']);
    if (id !== null && bool(raw['textEditable'])) editableTargets.add(id);
  }

  return { sourceSubreddit, targetSubreddit, templateIds, editableTargets };
};

export const communityFlairRestores = (
  catalogue: Json,
  reputation: Json,
  targetSubreddit: string,
  assignments: readonly RedditFlairAssignment[],
): readonly CommunityFlairRestore[] => {
  const projection = catalogueMapping(catalogue);
  if (normalise(targetSubreddit) !== normalise(projection.targetSubreddit)) {
    throw new Error(
      `Flair projection catalogue targets r/${projection.targetSubreddit}, not r/${targetSubreddit}`,
    );
  }
  if (!isMap(reputation) || !isMap(reputation['users'])) {
    throw new Error('Reputation projection users map is missing');
  }

  const live = new Map(assignments.map(item => [normalise(item.username), item]));
  const restores: CommunityFlairRestore[] = [];
  for (const raw of Object.values(reputation['users'])) {
    if (!isMap(raw)) continue;
    if (raw['status'] === 'moderator' || bool(raw['immutableModeratorFlair'])) continue;
    if (raw['status'] === 'unmapped' || bool(raw['needsReview'])) continue;

    const username = text(raw['username']);
    const sourceTemplateId = text(raw['desiredFlairTemplateId']);
    if (username === null || sourceTemplateId === null) continue;
    const targetTemplateId = projection.templateIds.get(sourceTemplateId);
    if (targetTemplateId === undefined) {
      throw new Error(`No r/${projection.targetSubreddit} flair mapping for canonical template ${sourceTemplateId}`);
    }

    const desiredText = text(raw['desiredFlairText']);
    const customText = projection.editableTargets.has(targetTemplateId) ? desiredText : null;
    const current = live.get(normalise(username));
    const correctTemplate = current?.templateId === targetTemplateId;
    const correctText = customText === null || current?.text === customText;
    if (correctTemplate && correctText) continue;
    restores.push({ username, templateId: targetTemplateId, customText });
  }

  return restores.sort((left, right) => left.username.localeCompare(right.username));
};

export const communityFlairRestoresFromFile = async (
  catalogueFile: string,
  reputation: Json,
  targetSubreddit: string,
  assignments: readonly RedditFlairAssignment[],
): Promise<readonly CommunityFlairRestore[]> => {
  let raw: string;
  try {
    raw = await readFile(catalogueFile, 'utf8');
  } catch (error) {
    const code = isMap(error as Json) ? text((error as unknown as Record<string, Json>)['code']) : null;
    if (code === 'ENOENT') return [];
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
  return communityFlairRestores(parseMap(raw), reputation, targetSubreddit, assignments);
};
