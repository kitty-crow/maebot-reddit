import type { RedditFlairAssignment, RedditFlairTemplate } from '../reddit/types.ts';

export type FlairKind = 'user' | 'post';

export type LogicalFlairMapping = {
  readonly kind: FlairKind;
  readonly logicalId: string;
  readonly sourceTemplateId: string;
};

export type FlairTemplatePlan = {
  readonly kind: FlairKind;
  readonly logicalId: string;
  readonly sourceTemplateId: string;
  readonly targetTemplateId: string | null;
  readonly action: 'reuse' | 'create' | 'ambiguous' | 'missing_source';
  readonly targetCandidates: readonly string[];
  readonly desired: RedditFlairTemplate | null;
};

export type FlairAssignmentPlan = {
  readonly username: string;
  readonly logicalId: string | null;
  readonly sourceTemplateId: string | null;
  readonly targetTemplateId: string | null;
  readonly action: 'already_correct' | 'assign' | 'blocked_unmapped' | 'blocked_target_template';
};

export type ModerationStatusMismatch = {
  readonly username: string;
  readonly kind: 'warned' | 'banned' | 'overlap';
  readonly localState: boolean;
  readonly visibleFlairState: boolean;
};

export type FlairMigrationPlan = {
  readonly userTemplates: readonly FlairTemplatePlan[];
  readonly postTemplates: readonly FlairTemplatePlan[];
  readonly assignments: readonly FlairAssignmentPlan[];
  readonly moderationMismatches: readonly ModerationStatusMismatch[];
  readonly unmappedSourceUserTemplates: readonly string[];
  readonly unmappedSourcePostTemplates: readonly string[];
};

const norm = (value: string | null): string => value ?? '';

const samePresentation = (left: RedditFlairTemplate, right: RedditFlairTemplate): boolean =>
  left.text === right.text
  && norm(left.cssClass) === norm(right.cssClass)
  && norm(left.textColour) === norm(right.textColour)
  && norm(left.backgroundColour) === norm(right.backgroundColour)
  && left.modOnly === right.modOnly
  && left.textEditable === right.textEditable
  && norm(left.allowableContent) === norm(right.allowableContent)
  && (left.maxEmojis ?? 0) === (right.maxEmojis ?? 0);

const validateMappings = (mappings: readonly LogicalFlairMapping[]): void => {
  const source = new Set<string>();
  const logical = new Set<string>();
  for (const mapping of mappings) {
    if (mapping.logicalId.trim().length === 0 || mapping.sourceTemplateId.trim().length === 0) {
      throw new Error('Flair mappings require non-empty logical and source template IDs');
    }
    const sourceKey = `${mapping.kind}:${mapping.sourceTemplateId}`;
    const logicalKey = `${mapping.kind}:${mapping.logicalId}`;
    if (source.has(sourceKey)) throw new Error(`Duplicate source flair mapping: ${sourceKey}`);
    if (logical.has(logicalKey)) throw new Error(`Duplicate logical flair mapping: ${logicalKey}`);
    source.add(sourceKey);
    logical.add(logicalKey);
  }
};

const planTemplates = (
  kind: FlairKind,
  source: readonly RedditFlairTemplate[],
  target: readonly RedditFlairTemplate[],
  mappings: readonly LogicalFlairMapping[],
): readonly FlairTemplatePlan[] => mappings
  .filter(mapping => mapping.kind === kind)
  .map(mapping => {
    const sourceTemplate = source.find(template => template.id === mapping.sourceTemplateId) ?? null;
    if (sourceTemplate === null) {
      return {
        kind,
        logicalId: mapping.logicalId,
        sourceTemplateId: mapping.sourceTemplateId,
        targetTemplateId: null,
        action: 'missing_source' as const,
        targetCandidates: [],
        desired: null,
      };
    }
    const candidates = target.filter(template => samePresentation(sourceTemplate, template));
    if (candidates.length === 1) {
      return {
        kind,
        logicalId: mapping.logicalId,
        sourceTemplateId: mapping.sourceTemplateId,
        targetTemplateId: candidates[0]?.id ?? null,
        action: 'reuse' as const,
        targetCandidates: candidates.map(template => template.id),
        desired: sourceTemplate,
      };
    }
    if (candidates.length > 1) {
      return {
        kind,
        logicalId: mapping.logicalId,
        sourceTemplateId: mapping.sourceTemplateId,
        targetTemplateId: null,
        action: 'ambiguous' as const,
        targetCandidates: candidates.map(template => template.id).sort(),
        desired: sourceTemplate,
      };
    }
    return {
      kind,
      logicalId: mapping.logicalId,
      sourceTemplateId: mapping.sourceTemplateId,
      targetTemplateId: null,
      action: 'create' as const,
      targetCandidates: [],
      desired: sourceTemplate,
    };
  });

const assignmentTemplate = (assignment: RedditFlairAssignment, templates: readonly RedditFlairTemplate[]): string | null => {
  if (assignment.templateId !== null) return assignment.templateId;
  const matches = templates.filter(template =>
    template.text === (assignment.text ?? '') && norm(template.cssClass) === norm(assignment.cssClass));
  return matches.length === 1 ? matches[0]?.id ?? null : null;
};

const planAssignments = (
  sourceAssignments: readonly RedditFlairAssignment[],
  sourceTemplates: readonly RedditFlairTemplate[],
  targetAssignments: readonly RedditFlairAssignment[],
  mappings: readonly LogicalFlairMapping[],
  templatePlans: readonly FlairTemplatePlan[],
): readonly FlairAssignmentPlan[] => {
  const targetByUser = new Map(targetAssignments.map(item => [item.username.toLowerCase(), item]));
  return sourceAssignments.map(source => {
    const sourceTemplateId = assignmentTemplate(source, sourceTemplates);
    const mapping = sourceTemplateId === null
      ? null
      : mappings.find(item => item.kind === 'user' && item.sourceTemplateId === sourceTemplateId) ?? null;
    if (mapping === null) {
      return {
        username: source.username,
        logicalId: null,
        sourceTemplateId,
        targetTemplateId: null,
        action: 'blocked_unmapped' as const,
      };
    }
    const plan = templatePlans.find(item => item.kind === 'user' && item.logicalId === mapping.logicalId) ?? null;
    if (plan === null || plan.action !== 'reuse' || plan.targetTemplateId === null) {
      return {
        username: source.username,
        logicalId: mapping.logicalId,
        sourceTemplateId,
        targetTemplateId: null,
        action: 'blocked_target_template' as const,
      };
    }
    const current = targetByUser.get(source.username.toLowerCase());
    return {
      username: source.username,
      logicalId: mapping.logicalId,
      sourceTemplateId,
      targetTemplateId: plan.targetTemplateId,
      action: current?.templateId === plan.targetTemplateId ? 'already_correct' as const : 'assign' as const,
    };
  });
};

const moderationMismatches = (
  assignments: readonly RedditFlairAssignment[],
  warned: ReadonlySet<string>,
  banned: ReadonlySet<string>,
): readonly ModerationStatusMismatch[] => {
  const byUser = new Map(assignments.map(item => [item.username.toLowerCase(), item]));
  const users = new Set<string>([
    ...assignments.map(item => item.username.toLowerCase()),
    ...warned,
    ...banned,
  ]);
  const out: ModerationStatusMismatch[] = [];
  for (const username of [...users].sort()) {
    const flair = byUser.get(username);
    const css = flair?.cssClass ?? null;
    const visibleWarned = css === 'w';
    const visibleBanned = css === 'u' || css === 's';
    const localWarned = warned.has(username);
    const localBanned = banned.has(username);
    if (localWarned !== visibleWarned) out.push({ username, kind: 'warned', localState: localWarned, visibleFlairState: visibleWarned });
    if (localBanned !== visibleBanned) out.push({ username, kind: 'banned', localState: localBanned, visibleFlairState: visibleBanned });
    if (localWarned && localBanned) out.push({ username, kind: 'overlap', localState: true, visibleFlairState: visibleWarned && visibleBanned });
  }
  return out;
};

export const planFlairMigration = (input: {
  readonly sourceUserTemplates: readonly RedditFlairTemplate[];
  readonly sourcePostTemplates: readonly RedditFlairTemplate[];
  readonly sourceAssignments: readonly RedditFlairAssignment[];
  readonly targetUserTemplates: readonly RedditFlairTemplate[];
  readonly targetPostTemplates: readonly RedditFlairTemplate[];
  readonly targetAssignments: readonly RedditFlairAssignment[];
  readonly mappings: readonly LogicalFlairMapping[];
  readonly warnedUsers: ReadonlySet<string>;
  readonly bannedUsers: ReadonlySet<string>;
}): FlairMigrationPlan => {
  validateMappings(input.mappings);
  const userTemplates = planTemplates('user', input.sourceUserTemplates, input.targetUserTemplates, input.mappings);
  const postTemplates = planTemplates('post', input.sourcePostTemplates, input.targetPostTemplates, input.mappings);
  const mappedUser = new Set(input.mappings.filter(item => item.kind === 'user').map(item => item.sourceTemplateId));
  const mappedPost = new Set(input.mappings.filter(item => item.kind === 'post').map(item => item.sourceTemplateId));
  return {
    userTemplates,
    postTemplates,
    assignments: planAssignments(
      input.sourceAssignments,
      input.sourceUserTemplates,
      input.targetAssignments,
      input.mappings,
      userTemplates,
    ),
    moderationMismatches: moderationMismatches(input.sourceAssignments, input.warnedUsers, input.bannedUsers),
    unmappedSourceUserTemplates: input.sourceUserTemplates.map(item => item.id).filter(id => !mappedUser.has(id)).sort(),
    unmappedSourcePostTemplates: input.sourcePostTemplates.map(item => item.id).filter(id => !mappedPost.has(id)).sort(),
  };
};
