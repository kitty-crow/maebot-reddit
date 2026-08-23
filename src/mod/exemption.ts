export type ModerationExemption = 'bot' | 'moderator' | null;

const normalise = (value: string): string => value.trim().toLowerCase();

export const moderationExemption = (
  author: string | null,
  botUsername: string,
  moderators: ReadonlySet<string>,
): ModerationExemption => {
  if (author === null) return null;
  const key = normalise(author);
  if (key === normalise(botUsername)) return 'bot';
  if (moderators.has(key)) return 'moderator';
  return null;
};

export const moderatorSet = (usernames: readonly string[]): ReadonlySet<string> =>
  new Set(usernames.map(normalise));
