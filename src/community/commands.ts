export type CommunityCommand = 'remove' | 'thankyou';

export const command = (body: string): CommunityCommand | null => {
  if (body.startsWith('!remove')) return 'remove';
  if (body.startsWith('!thankyou')) return 'thankyou';
  return null;
};

export const canChooseAnswer = (
  actor: string,
  submissionAuthor: string | null,
  moderators: ReadonlySet<string>,
): boolean => actor === submissionAuthor || moderators.has(actor);

export const canRemoveParent = canChooseAnswer;
