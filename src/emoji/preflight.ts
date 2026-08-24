import type { RedditEmoji } from '../reddit/emoji.ts';
import { safeError } from '../reddit/error.ts';
import type { RedditAccount, RedditModerator } from '../reddit/types.ts';

export type EmojiPreflightReader = {
  me(): Promise<RedditAccount>;
  moderators(subreddit: string): Promise<readonly RedditModerator[]>;
  emojis(subreddit: string): Promise<readonly RedditEmoji[]>;
};

export type EmojiCommunityRequirement = {
  readonly subreddit: string;
  readonly requireManageSettings: boolean;
};

export type EmojiCommunityPreflight = {
  readonly subreddit: string;
  readonly moderator: boolean;
  readonly manageSettings: boolean;
  readonly manageSettingsRequired: boolean;
  readonly grantedPermissions: readonly string[];
  readonly emojiInventoryReadable: boolean;
  readonly emojiCount: number | null;
  readonly failures: readonly string[];
  readonly passed: boolean;
};

export type EmojiClonePreflight = {
  readonly accountName: string;
  readonly communities: readonly EmojiCommunityPreflight[];
  readonly passed: boolean;
};

const permissionSet = (moderator: RedditModerator): ReadonlySet<string> =>
  new Set(moderator.permissions.map(value => value.toLowerCase()));

const moderatorFor = (
  accountName: string,
  moderators: readonly RedditModerator[],
): RedditModerator | null => {
  const key = accountName.toLowerCase();
  return moderators.find(moderator => moderator.name.toLowerCase() === key) ?? null;
};

const checkCommunity = async (
  read: EmojiPreflightReader,
  accountName: string,
  requirement: EmojiCommunityRequirement,
): Promise<EmojiCommunityPreflight> => {
  const failures: string[] = [];
  let moderator = false;
  let manageSettings = false;
  let grantedPermissions: readonly string[] = [];
  let emojiInventoryReadable = false;
  let emojiCount: number | null = null;

  try {
    const moderators = await read.moderators(requirement.subreddit);
    const entry = moderatorFor(accountName, moderators);
    if (entry === null) {
      failures.push(`u/${accountName} is not a moderator`);
    } else {
      moderator = true;
      grantedPermissions = [...entry.permissions];
      const granted = permissionSet(entry);
      manageSettings = granted.has('all') || granted.has('config');
      if (requirement.requireManageSettings && !manageSettings) {
        failures.push('Manage Settings (`config`) is required but missing');
      }
    }
  } catch (error) {
    failures.push(`moderator inventory failed: ${safeError(error)}`);
  }

  try {
    const emojis = await read.emojis(requirement.subreddit);
    emojiInventoryReadable = true;
    emojiCount = emojis.length;
  } catch (error) {
    failures.push(`custom emoji inventory failed: ${safeError(error)}`);
  }

  const passed = moderator
    && emojiInventoryReadable
    && (!requirement.requireManageSettings || manageSettings);

  return {
    subreddit: requirement.subreddit,
    moderator,
    manageSettings,
    manageSettingsRequired: requirement.requireManageSettings,
    grantedPermissions,
    emojiInventoryReadable,
    emojiCount,
    failures,
    passed,
  };
};

export const emojiClonePreflight = async (
  read: EmojiPreflightReader,
  requirements: readonly EmojiCommunityRequirement[],
): Promise<EmojiClonePreflight> => {
  const account = await read.me();
  const communities: EmojiCommunityPreflight[] = [];

  for (const requirement of requirements) {
    communities.push(await checkCommunity(read, account.name, requirement));
  }

  return {
    accountName: account.name,
    communities,
    passed: communities.every(community => community.passed),
  };
};
