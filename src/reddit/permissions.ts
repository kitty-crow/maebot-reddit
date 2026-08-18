import type { RedditModerator } from './types.ts';

export type RedditModeratorPermission = 'access' | 'flair' | 'posts';

const moderatorFor = (
  accountName: string,
  moderators: readonly RedditModerator[],
): RedditModerator | null => {
  const key = accountName.toLowerCase();
  return moderators.find(moderator => moderator.name.toLowerCase() === key) ?? null;
};

const hasPermission = (moderator: RedditModerator, permission: RedditModeratorPermission): boolean =>
  moderator.permissions.includes('all') || moderator.permissions.includes(permission);

export const assertModeratorPermissions = (
  accountName: string,
  subreddit: string,
  moderators: readonly RedditModerator[],
  required: readonly RedditModeratorPermission[],
): void => {
  const moderator = moderatorFor(accountName, moderators);
  if (moderator === null) {
    throw new Error(`${accountName} is not a moderator of r/${subreddit}`);
  }

  const missing = required.filter(permission => !hasPermission(moderator, permission));
  if (missing.length === 0) return;

  const granted = moderator.permissions.length === 0 ? 'none' : moderator.permissions.join(', ');
  throw new Error(
    `${accountName} is missing required moderator permissions in r/${subreddit}: ${missing.join(', ')} `
    + `(granted: ${granted}). Grant Full Permissions or at least ${required.join(', ')} before migration.`,
  );
};
