import type { ReputationBootstrap } from './store.ts';

export type ReputationFlairWriter = {
  setUserFlairTemplate(
    subreddit: string,
    username: string,
    templateId: string,
    customText: string | null,
  ): Promise<void>;
};

export type ReputationFlairMutation = {
  readonly username: string;
  readonly templateId: string;
  readonly text: string;
};

export const plannedBootstrapFlairMutations = (
  bootstrap: ReputationBootstrap,
): readonly ReputationFlairMutation[] => bootstrap.users.flatMap(user => {
  if (!user.needsFlair) return [];
  if (user.immutableModeratorFlair || user.status === 'moderator') {
    throw new Error(`Refusing to assign a tier flair to moderator u/${user.username}`);
  }
  if (user.status !== 'ordinary') {
    throw new Error(`Refusing to assign a tier flair to non-ordinary u/${user.username}`);
  }
  if (user.desiredFlairTemplateId === null || user.desiredFlairText === null) {
    throw new Error(`Missing desired flair reference for u/${user.username}`);
  }
  return [{
    username: user.username,
    templateId: user.desiredFlairTemplateId,
    text: user.desiredFlairText,
  }];
});

export const applyBootstrapFlairs = async (
  subreddit: string,
  bootstrap: ReputationBootstrap,
  writer: ReputationFlairWriter,
): Promise<number> => {
  const mutations = plannedBootstrapFlairMutations(bootstrap);
  for (const mutation of mutations) {
    await writer.setUserFlairTemplate(subreddit, mutation.username, mutation.templateId, null);
  }
  return mutations.length;
};
