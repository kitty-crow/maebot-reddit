import type { RedditFlairAssignment, RedditFlairTemplate } from '../reddit/types.ts';
import { isMap, type Json } from '../types/json.ts';
import type {
  ReputationBootstrap,
  ReputationPendingFlair,
  ReputationUser,
} from './store.ts';

export type ReputationFlairWriter = {
  setUserFlairTemplate(
    subreddit: string,
    username: string,
    templateId: string,
    customText: string | null,
  ): Promise<void>;
};

export type ReputationFlairReconcileResult = {
  readonly bootstrap: ReputationBootstrap;
  readonly applied: number;
};

const visibleText = (value: string | null): string | null =>
  value === null || value.trim().length === 0 ? null : value;

const appliedUser = (
  user: ReputationUser,
  template: RedditFlairTemplate,
): ReputationUser => ({
  ...user,
  currentFlairTemplateId: template.id,
  currentFlairText: visibleText(user.desiredFlairText) ?? template.text,
  currentFlairCssClass: template.cssClass,
  desiredFlairTemplateId: template.id,
  desiredFlairText: visibleText(user.desiredFlairText) ?? template.text,
  needsFlair: false,
});

export const applyBootstrapFlairs = async (
  bootstrap: ReputationBootstrap,
  writer: ReputationFlairWriter,
): Promise<ReputationFlairReconcileResult> => {
  const templates = new Map(bootstrap.userFlairTemplates.map(template => [template.id, template]));
  const users: ReputationUser[] = [];
  let applied = 0;

  for (const user of bootstrap.users) {
    if (!user.needsFlair) {
      users.push(user);
      continue;
    }
    if (user.immutableModeratorFlair || user.status === 'moderator') {
      throw new Error(`Moderator u/${user.username} must never require reputation flair reconciliation`);
    }
    const templateId = user.desiredFlairTemplateId;
    if (templateId === null) throw new Error(`u/${user.username} requires a flair but has no desired template id`);
    const template = templates.get(templateId);
    if (template === undefined) throw new Error(`Desired flair template ${templateId} for u/${user.username} is absent from inventory`);

    await writer.setUserFlairTemplate(
      bootstrap.subreddit,
      user.username,
      template.id,
      template.textEditable ? visibleText(user.desiredFlairText) : null,
    );
    users.push(appliedUser(user, template));
    applied += 1;
  }

  return {
    applied,
    bootstrap: {
      ...bootstrap,
      users,
    },
  };
};

const normalise = (value: string): string => value.trim().toLowerCase();
const textOrNull = (value: Json | undefined): string | null => typeof value === 'string' ? value : null;
const nonBlankText = (value: Json | undefined): string | null => visibleText(textOrNull(value));
const flag = (value: Json | undefined): boolean => value === true;

const catalogueText = (raw: Json, templateId: string): string | null => {
  if (!isMap(raw)) return null;
  const catalogue = raw['flairCatalog'];
  if (!isMap(catalogue)) return null;
  const users = catalogue['user'];
  if (!Array.isArray(users)) return null;
  for (const value of users) {
    if (!isMap(value) || value['id'] !== templateId) continue;
    return nonBlankText(value['text']);
  }
  return null;
};

export const authoritativeFlairRestores = (
  raw: Json,
  assignments: readonly RedditFlairAssignment[],
): readonly ReputationPendingFlair[] => {
  if (!isMap(raw)) throw new Error('Reputation flair reconciliation root must be an object');
  const users = raw['users'];
  if (!isMap(users)) throw new Error('Reputation flair reconciliation users map is missing');

  const live = new Map<string, RedditFlairAssignment>();
  for (const assignment of assignments) live.set(normalise(assignment.username), assignment);

  const restores: ReputationPendingFlair[] = [];
  for (const value of Object.values(users)) {
    if (!isMap(value)) continue;
    if (value['status'] === 'moderator' || flag(value['immutableModeratorFlair'])) continue;
    if (flag(value['needsFlair'])) continue;

    const username = nonBlankText(value['username']);
    const templateId = nonBlankText(value['desiredFlairTemplateId']);
    if (username === null || templateId === null) continue;
    const flairText = nonBlankText(value['desiredFlairText']) ?? catalogueText(raw, templateId);
    if (flairText === null) continue;

    const assignment = live.get(normalise(username));
    const liveText = visibleText(assignment?.text ?? null);
    const wrongText = assignment === undefined || liveText !== flairText;
    // Reddit's /api/flairlist can omit flair_template_id for legacy assignments.
    // Missing UUID is unknown, not evidence of a wrong template. Explicitly
    // returned mismatched UUIDs remain authoritative evidence and are restored.
    const wrongTemplate = assignment !== undefined
      && assignment.templateId !== null
      && assignment.templateId !== templateId;
    if (!wrongTemplate && !wrongText) continue;

    restores.push({ username, templateId, text: flairText });
  }

  return restores.sort((a, b) => a.username.localeCompare(b.username));
};
