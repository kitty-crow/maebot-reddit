import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { redditConfig } from '../src/env.ts';
import { planReputationBootstrap } from '../src/reputation/bootstrap.ts';
import { ReputationStore } from '../src/reputation/store.ts';
import { RedditReadClient } from '../src/reddit/client.ts';
import { safeError } from '../src/reddit/error.ts';
import type { RedditFlairTemplate } from '../src/reddit/types.ts';
import type { JsonMap } from '../src/types/json.ts';

const cfg = redditConfig();
const flag = (name: string): boolean => process.argv.includes(name);
const valueArg = (prefix: string): string | null => {
  const value = process.argv.find(arg => arg.startsWith(`${prefix}=`));
  return value === undefined ? null : value.slice(prefix.length + 1).trim();
};

const subreddit = (valueArg('--subreddit') ?? cfg.sourceSubreddit).replace(/^r\//iu, '');
const force = flag('--force');
const reportPath = resolve(process.cwd(), valueArg('--report') ?? 'data/reputation-bootstrap-report.json');
const statePath = resolve(process.cwd(), valueArg('--state') ?? 'data/reputation.pb');
const now = Math.floor(Date.now() / 1_000);
const client = new RedditReadClient(cfg.auth);

const reportTemplate = (template: RedditFlairTemplate): JsonMap => ({
  id: template.id,
  text: template.text,
  cssClass: template.cssClass,
  modOnly: template.modOnly,
  textEditable: template.textEditable,
  textColour: template.textColour,
  backgroundColour: template.backgroundColour,
});

try {
  const [userFlairs, postFlairs, assignments, moderators, bannedUsers, posts, comments] = await Promise.all([
    client.userFlairTemplates(subreddit),
    client.postFlairTemplates(subreddit),
    client.userFlairAssignments(subreddit),
    client.moderators(subreddit),
    client.bannedUsers(subreddit),
    client.newPostsHistory(subreddit, 1000),
    client.newCommentsHistory(subreddit, 1000),
  ]);

  console.log(`=== r/${subreddit} USER FLAIRS (${userFlairs.length}) ===`);
  for (const template of userFlairs) {
    console.log(`${template.id}\t${JSON.stringify(template.text)}\tcss=${template.cssClass ?? '-'}\tmodOnly=${template.modOnly}`);
  }

  console.log(`\n=== r/${subreddit} POST FLAIRS (${postFlairs.length}) ===`);
  for (const template of postFlairs) {
    console.log(`${template.id}\t${JSON.stringify(template.text)}\tcss=${template.cssClass ?? '-'}\tmodOnly=${template.modOnly}`);
  }

  const plan = planReputationBootstrap({
    subreddit,
    at: now,
    userFlairs,
    postFlairs,
    assignments,
    moderators,
    bannedUsers,
    posts,
    comments,
  });
  const bootstrap = plan.bootstrap;
  const references = bootstrap.flairReferences;

  const byTier = new Map<number, number>();
  const byStatus = new Map<string, number>();
  let needsFlair = 0;
  let needsReview = 0;
  for (const value of bootstrap.users) {
    byTier.set(value.tier, (byTier.get(value.tier) ?? 0) + 1);
    byStatus.set(value.status, (byStatus.get(value.status) ?? 0) + 1);
    if (value.needsFlair) needsFlair += 1;
    if (value.needsReview) needsReview += 1;
  }

  const report = {
    generatedAt: new Date(now * 1_000).toISOString(),
    subreddit,
    statePath,
    coverage: bootstrap.coverage,
    flairReferences: references,
    userFlairs: userFlairs.map(reportTemplate),
    postFlairs: postFlairs.map(reportTemplate),
    summary: {
      usersPersisted: bootstrap.users.length,
      byTier: Object.fromEntries([...byTier.entries()].sort((a, b) => a[0] - b[0])),
      byStatus: Object.fromEntries([...byStatus.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
      needsFlair,
      needsReview,
    },
    users: bootstrap.users,
  };

  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');

  const store = new ReputationStore(statePath);
  await store.bootstrap(bootstrap, force);
  if (!(await store.hasBootstrap())) throw new Error('Reputation protobuf did not verify after bootstrap');

  console.log('\n=== SEMANTIC FLAIR REFERENCES ===');
  console.log(`user :mae:                      ${references.user.mae}`);
  console.log(`user :lisa:                     ${references.user.lisa}`);
  console.log(`user :kita:                     ${references.user.kita}`);
  console.log(`user :aoi:                      ${references.user.aoi}`);
  console.log(`user :hana:                     ${references.user.hana}`);
  console.log(`user :rin:                      ${references.user.rin}`);
  console.log(`user :celeste:                  ${references.user.celeste}`);
  console.log(`user Warned                     ${references.user.warned ?? 'NOT RESOLVED'}`);
  console.log(`user Uncivil                    ${references.user.uncivil ?? 'NOT RESOLVED'}`);
  console.log(`user SCAM                       ${references.user.scam ?? 'NOT RESOLVED'}`);
  console.log(`post Minor Announcement :lisa: ${references.post.minorAnnouncement ?? 'NOT RESOLVED'}`);
  console.log(`post Announcement :catgirl-moon: ${references.post.announcement ?? 'NOT RESOLVED'}`);

  console.log('\n=== REPUTATION BOOTSTRAP ===');
  console.log(`protobuf: ${statePath}`);
  console.log(`report:   ${reportPath}`);
  console.log(`users persisted: ${bootstrap.users.length}`);
  console.log(`tier 0: ${byTier.get(0) ?? 0}`);
  console.log(`tier 1: ${byTier.get(1) ?? 0}`);
  console.log(`tier 2: ${byTier.get(2) ?? 0}`);
  console.log(`tier 3: ${byTier.get(3) ?? 0}`);
  console.log(`tier 4: ${byTier.get(4) ?? 0}`);
  console.log(`unflaired contributors found in accessible history: ${plan.recentContributorsWithoutFlair}`);
  console.log(`records requiring manual semantic review: ${needsReview}`);
  console.log(`records requiring a tier flair application: ${needsFlair}`);
  console.log(`NOTE: ${bootstrap.coverage.note}`);

  const reviewUsers = bootstrap.users.filter(value => value.needsReview);
  if (reviewUsers.length > 0) {
    console.log('\n=== USERS REQUIRING REVIEW ===');
    for (const value of reviewUsers) {
      console.log(`u/${value.username}\tflair=${JSON.stringify(value.currentFlairText)}\tcss=${value.currentFlairCssClass ?? '-'}\tsource=${value.source}`);
    }
  }

  const flairUsers = bootstrap.users.filter(value => value.needsFlair);
  if (flairUsers.length > 0) {
    console.log('\n=== DISCOVERED USERS WITHOUT FLAIR ===');
    for (const value of flairUsers) {
      console.log(`u/${value.username}\tpoints=${value.points}\tdesired=${value.desiredFlairText}\ttemplate=${value.desiredFlairTemplateId}`);
    }
  }
} catch (error) {
  console.error(`Reputation bootstrap failed: ${safeError(error)}`);
  process.exitCode = 1;
}
