import type { RedditReadClient } from './client.ts';
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
  const [subreddit, moderators, userFlairTemplates, postFlairTemplates, rules, sticky1, sticky2, recentPosts, recentComments] = await Promise.all([
    client.subreddit(name),
    client.moderators(name),
    client.userFlairTemplates(name),
    client.postFlairTemplates(name),
    client.rules(name),
    client.sticky(name, 1),
    client.sticky(name, 2),
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
    stickies: [sticky1, sticky2],
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
  const primaryAudit = await one(client, primary, false);
  return {
    generatedAt: new Date().toISOString(),
    account,
    source: sourceAudit,
    primary: primaryAudit,
  };
};
