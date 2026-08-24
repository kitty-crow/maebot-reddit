import { RedditReadClient } from '../reddit/client.ts';
import { RedditMutationClient } from '../reddit/mutate.ts';
import type { RedditFlairAssignment, RedditFlairTemplate } from '../reddit/types.ts';

export type FlairCloneResult = {
  readonly userTemplatesCreated: number;
  readonly postTemplatesCreated: number;
  readonly userAssignmentsApplied: number;
  readonly userAssignmentsAlreadyCorrect: number;
};

export type FlairCloneOptions = {
  readonly copyAssignments?: boolean;
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

const assignmentTemplate = (
  assignment: RedditFlairAssignment,
  templates: readonly RedditFlairTemplate[],
): RedditFlairTemplate | null => {
  if (assignment.templateId !== null) {
    return templates.find(template => template.id === assignment.templateId) ?? null;
  }
  const matches = templates.filter(template =>
    template.text === (assignment.text ?? '') && norm(template.cssClass) === norm(assignment.cssClass));
  return matches.length === 1 ? matches[0] ?? null : null;
};

const targetFor = (
  source: RedditFlairTemplate,
  targets: readonly RedditFlairTemplate[],
  kind: 'user' | 'post',
): RedditFlairTemplate => {
  const matches = targets.filter(target => samePresentation(source, target));
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one semantic destination for ${kind} flair ${source.id} (${JSON.stringify(source.text)}), found ${matches.length}`,
    );
  }
  const match = matches[0];
  if (match === undefined) throw new Error('Resolved flair target disappeared');
  return match;
};

const assignmentMatches = (
  current: RedditFlairAssignment | undefined,
  target: RedditFlairTemplate,
  desiredText: string | null,
): boolean => {
  if (current === undefined) return false;
  if (current.templateId !== null) return current.templateId === target.id && (current.text ?? '') === (desiredText ?? target.text);
  return (current.text ?? '') === (desiredText ?? target.text) && norm(current.cssClass) === norm(target.cssClass);
};

export class FlairCloner {
  public constructor(
    private readonly read: RedditReadClient,
    private readonly write: RedditMutationClient,
  ) {}

  public async clone(
    sourceSubreddit: string,
    targetSubreddit: string,
    options: FlairCloneOptions = {},
  ): Promise<FlairCloneResult> {
    const [sourceUsers, sourcePosts, sourceAssignments, initialTargetUsers, initialTargetPosts] = await Promise.all([
      this.read.userFlairTemplates(sourceSubreddit),
      this.read.postFlairTemplates(sourceSubreddit),
      this.read.userFlairAssignments(sourceSubreddit),
      this.read.userFlairTemplates(targetSubreddit),
      this.read.postFlairTemplates(targetSubreddit),
    ]);

    let userTemplatesCreated = 0;
    let postTemplatesCreated = 0;

    for (const source of sourceUsers) {
      const matches = initialTargetUsers.filter(target => samePresentation(source, target));
      if (matches.length > 1) throw new Error(`Ambiguous destination user flair for source template ${source.id}`);
      if (matches.length === 0) {
        await this.write.createFlairTemplate(targetSubreddit, 'user', source);
        userTemplatesCreated += 1;
      }
    }

    for (const source of sourcePosts) {
      const matches = initialTargetPosts.filter(target => samePresentation(source, target));
      if (matches.length > 1) throw new Error(`Ambiguous destination post flair for source template ${source.id}`);
      if (matches.length === 0) {
        await this.write.createFlairTemplate(targetSubreddit, 'post', source);
        postTemplatesCreated += 1;
      }
    }

    const [targetUsers, targetPosts, targetAssignments] = await Promise.all([
      this.read.userFlairTemplates(targetSubreddit),
      this.read.postFlairTemplates(targetSubreddit),
      this.read.userFlairAssignments(targetSubreddit),
    ]);

    for (const source of sourceUsers) targetFor(source, targetUsers, 'user');
    for (const source of sourcePosts) targetFor(source, targetPosts, 'post');

    if (options.copyAssignments === false) {
      return {
        userTemplatesCreated,
        postTemplatesCreated,
        userAssignmentsApplied: 0,
        userAssignmentsAlreadyCorrect: 0,
      };
    }

    const targetByUsername = new Map(targetAssignments.map(item => [item.username.toLowerCase(), item]));
    let userAssignmentsApplied = 0;
    let userAssignmentsAlreadyCorrect = 0;

    for (const assignment of sourceAssignments) {
      const sourceTemplate = assignmentTemplate(assignment, sourceUsers);
      if (sourceTemplate === null) {
        const current = targetByUsername.get(assignment.username.toLowerCase());
        const sameDirect = current !== undefined
          && (current.text ?? '') === (assignment.text ?? '')
          && norm(current.cssClass) === norm(assignment.cssClass);
        if (sameDirect) {
          userAssignmentsAlreadyCorrect += 1;
          continue;
        }
        await this.write.setUserFlairDirect(
          targetSubreddit,
          assignment.username,
          assignment.text,
          assignment.cssClass,
        );
        userAssignmentsApplied += 1;
        continue;
      }

      const target = targetFor(sourceTemplate, targetUsers, 'user');
      const desiredText = sourceTemplate.textEditable ? assignment.text : null;
      const current = targetByUsername.get(assignment.username.toLowerCase());
      if (assignmentMatches(current, target, desiredText)) {
        userAssignmentsAlreadyCorrect += 1;
        continue;
      }
      await this.write.setUserFlairTemplate(targetSubreddit, assignment.username, target.id, desiredText);
      userAssignmentsApplied += 1;
    }

    return {
      userTemplatesCreated,
      postTemplatesCreated,
      userAssignmentsApplied,
      userAssignmentsAlreadyCorrect,
    };
  }
}
