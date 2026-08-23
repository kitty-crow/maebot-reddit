import type { RedditFlairTemplate } from '../reddit/types.ts';
import type { ReputationBootstrap, ReputationUser } from './store.ts';

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

const appliedUser = (
  user: ReputationUser,
  template: RedditFlairTemplate,
): ReputationUser => ({
  ...user,
  currentFlairTemplateId: template.id,
  currentFlairText: user.desiredFlairText ?? template.text,
  currentFlairCssClass: template.cssClass,
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
      template.textEditable ? user.desiredFlairText : null,
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
