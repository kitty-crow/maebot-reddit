import { readFile } from 'node:fs/promises';
import type { RedditFlairAssignment } from '../reddit/types.ts';
import { isMap, parseMap, type Json } from '../types/json.ts';

export type CommunityFlairRestore = {
  readonly username: string;
  readonly templateId: string;
  readonly customText: string | null;
};

type CommunityProjectionCatalogue = {
  readonly sourceSubreddit: string;
  readonly targetSubreddit: string;
  readonly templateIds: ReadonlyMap<string, string>;
  readonly targetTexts: ReadonlyMap<string, string>;
  readonly editableTargets: ReadonlySet<string>;
};

const normalise = (value: string): string => value.trim().toLowerCase();
const text = (value: Json | undefined): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;
const anyText = (value: Json | undefined): string | null => typeof value === 'string' ? value : null;
const bool = (value: Json | undefined): boolean => value === true;

const catalogueMapping = (catalogue: Json): CommunityProjectionCatalogue => {
  if (!isMap(catalogue)) throw new Error('Flair projection catalogue root must be an object');
  if (catalogue['schema'] !== 2) throw new Error('Flair projection catalogue is not a completed schema-2 bootstrap');
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

  const targetTexts = new Map<string, string>();
  const editableTargets = new Set<string>();
  for (const raw of targets) {
    if (!isMap(raw)) continue;
    const id = text(raw['id']);
    const targetText = anyText(raw['text']);
    if (id === null || targetText === null) continue;
    targetTexts.set(id, targetText);
    if (bool(raw['textEditable'])) editableTargets.add(id);
  }

  return { sourceSubreddit, targetSubreddit, templateIds, targetTexts, editableTargets };
};

const readCatalogue = async (catalogueFile: string): Promise<Json | null> => {
  let raw: string;
  try {
    raw = await readFile(catalogueFile, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
  return parseMap(raw);
};

const requireCommunities = (
  projection: CommunityProjectionCatalogue,
  sourceSubreddit: string,
  targetSubreddit: string,
): void => {
  if (
    normalise(sourceSubreddit) !== normalise(projection.sourceSubreddit)
    || normalise(targetSubreddit) !== normalise(projection.targetSubreddit)
  ) {
    throw new Error(
      `Flair projection catalogue is r/${projection.sourceSubreddit} -> r/${projection.targetSubreddit}, `
      + `not r/${sourceSubreddit} -> r/${targetSubreddit}`,
    );
  }
};

export const communityProjectionReadyFromFile = async (
  catalogueFile: string,
  sourceSubreddit: string,
  targetSubreddit: string,
): Promise<boolean> => {
  const catalogue = await readCatalogue(catalogueFile);
  if (catalogue === null) return false;
  // Schema 2 is the explicit activation marker written only after a complete
  // community bootstrap. Older catalogues are historical evidence and must not
  // prevent Mae from starting the pre-bootstrap dual-community moderation path.
  if (!isMap(catalogue) || catalogue['schema'] !== 2) return false;
  const projection = catalogueMapping(catalogue);
  requireCommunities(projection, sourceSubreddit, targetSubreddit);
  return true;
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

    const targetText = projection.targetTexts.get(targetTemplateId);
    if (targetText === undefined) {
      throw new Error(`Target flair template ${targetTemplateId} is absent from r/${projection.targetSubreddit} catalogue inventory`);
    }
    const desiredText = anyText(raw['desiredFlairText']);
    const customText = projection.editableTargets.has(targetTemplateId) ? desiredText : null;
    const projectedText = customText ?? targetText;
    const current = live.get(normalise(username));
    const wrongText = current === undefined || current.text !== projectedText;
    // /api/flairlist may omit flair_template_id. Treat a missing UUID as
    // unknown rather than forcing a rewrite of an already-correct visible flair.
    const wrongTemplate = current !== undefined
      && current.templateId !== null
      && current.templateId !== targetTemplateId;
    if (!wrongTemplate && !wrongText) continue;
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
  const catalogue = await readCatalogue(catalogueFile);
  if (catalogue === null) return [];
  return communityFlairRestores(catalogue, reputation, targetSubreddit, assignments);
};
