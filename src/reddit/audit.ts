import type { RedditReadClient } from './client.ts';
import { readStickySlots } from './stickySlots.ts';
import type {
  RedditAccount,
  RedditComment,
  RedditFlairAssignment,
  RedditFlairTemplate,
  RedditModerator,
  RedditPost,
  RedditRule,
  RedditSubreddit,
} from './types.ts';

export type RedditAuditSubreddit = {
  readonly subreddit: RedditSubreddit;
  readonly moderators: readonly RedditModerator[];
  readonly userFlairTemplates: readonly RedditFlairTemplate[];
  readonly postFlairTemplates: readonly RedditFlairTemplate[];
  readonly userFlairAssignments: readonly RedditFlairAssignment[] | null;
  readonly rules: readonly RedditRule[];
  readonly siteRules: readonly string[];
  readonly stickies: readonly (RedditPost | null)[];
  readonly recentPosts: readonly RedditPost[];
  readonly recentComments: readonly RedditComment[];
};

export type RedditAudit = {
  readonly generatedAt: string;
  readonly account: RedditAccount;
  readonly source: RedditAuditSubreddit;
  readonly primary: RedditAuditSubreddit;
};

const one = async (
  client: RedditReadClient,
  name: string,
  includeAssignments: boolean,
): Promise<RedditAuditSubreddit> => {
  const [subreddit, moderators, userFlairTemplates, postFlairTemplates, rules, stickies, recentPosts, recentComments] = await Promise.all([
    client.subreddit(name),
    client.moderators(name),
    client.userFlairTemplates(name),
    client.postFlairTemplates(name),
    client.rules(name),
    readStickySlots(client, name),
    client.newPosts(name, 25),
    client.newComments(name, 25),
  ]);
  const assignments = includeAssignments ? await client.userFlairAssignments(name) : null;
  return {
    subreddit,
    moderators,
    userFlairTemplates,
    postFlairTemplates,
    userFlairAssignments: assignments,
    rules: rules.rules,
    siteRules: rules.siteRules,
    stickies,
    recentPosts,
    recentComments,
  };
};

export const auditReddit = async (
  client: RedditReadClient,
  source: string,
  primary: string,
): Promise<RedditAudit> => {
  const account = await client.me();
  const sourceAudit = await one(client, source, true);
  const primaryAudit = await one(client, primary, true);
  return {
    generatedAt: new Date().toISOString(),
    account,
    source: sourceAudit,
    primary: primaryAudit,
  };
};
