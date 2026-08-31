import 'dotenv/config';
import { resolve } from 'node:path';
import { redditConfig, redditModerationConfig } from '../src/env.ts';
import {
  RedditModerationClassifier,
  type ModerationClassification,
  type ModerationItem,
} from '../src/mod/classifier.ts';
import { MemberContributionAssessor, memberModNoteText, type MemberCommentAssessment } from '../src/modnotes/assessor.ts';
import { memberInventoryFromReputation } from '../src/modnotes/inventory.ts';
import { MemberModNotesRedditClient } from '../src/modnotes/reddit.ts';
import { MemberModNoteStore } from '../src/modnotes/store.ts';
import { moderationHistoryFor } from '../src/reputation/moderationHistory.ts';
import { ReputationStore } from '../src/reputation/store.ts';
import { safeError } from '../src/reddit/error.ts';
import type { RedditComment } from '../src/reddit/types.ts';

const canonicalCommunities = ['catgirlcoin', 'nyaonearth'] as const;
const apply = process.argv.includes('--apply');
const refresh = process.argv.includes('--refresh');
const onlyArg = process.argv.find(arg => arg.startsWith('--user='));
const onlyUser = onlyArg === undefined ? null : onlyArg.slice('--user='.length).trim().toLowerCase();

const redditCfg = redditConfig();
const moderationCfg = redditModerationConfig();
if (moderationCfg === null) {
  throw new Error('Member Mod Notes experiment requires REDDIT_MODERATION_ENABLED=true');
}

const reputation = new ReputationStore(moderationCfg.stateFile);
const notes = new MemberModNoteStore(resolve(
  process.cwd(),
  process.env['REDDIT_MEMBER_MOD_NOTES_FILE']?.trim() || 'data/memberModNotes.pb',
));
const reddit = new MemberModNotesRedditClient(redditCfg.auth);
const classifier = new RedditModerationClassifier(moderationCfg.ai);
const assessor = new MemberContributionAssessor(moderationCfg.ai);

const inventory = memberInventoryFromReputation(await reputation.raw());
const members = inventory.filter(user => !user.moderator && (onlyUser === null || user.username.toLowerCase() === onlyUser));
if (onlyUser !== null && members.length === 0) throw new Error(`No non-moderator reputation member found for u/${onlyUser}`);
await notes.seed(members.map(user => user.username));

const moderationItem = (comment: RedditComment, history: ReturnType<typeof moderationHistoryFor>): ModerationItem => ({
  kind: 'comment',
  subreddit: comment.subreddit,
  author: comment.author ?? '[deleted]',
  title: '',
  text: comment.body,
  permalink: comment.permalink,
  mediaUrls: comment.mediaUrls,
  history,
});

const classify = async (comment: RedditComment, username: string): Promise<ModerationClassification> => {
  const history = moderationHistoryFor(await reputation.raw(), username);
  return await classifier.classify(moderationItem(comment, history));
};

const sameSample = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

let generated = 0;
let reused = 0;
let scored = 0;
let posted = 0;
let failed = 0;

console.log(
  `[Member Mod Notes] members=${members.length} mode=${apply ? 'APPLY' : 'PREVIEW'} communities=${canonicalCommunities.join(',')}`,
);
if (!apply) {
  console.log('[Member Mod Notes] preview mode writes only the separate memberModNotes.pb store; add --apply to score untracked sampled comments and post native Reddit Mod Notes.');
}

for (let index = 0; index < members.length; index += 1) {
  const member = members[index];
  if (member === undefined) continue;
  const progress = `${index + 1}/${members.length}`;
  try {
    const comments = await reddit.recentCommentsInCommunities(member.username, canonicalCommunities, 10, 1_000);
    const sampleFullnames = comments.map(comment => comment.fullname);
    const existing = await notes.record(member.username);
    const allAlreadyScored = apply
      ? (await Promise.all(comments.map(comment => reputation.hasContribution(comment.fullname)))).every(Boolean)
      : false;

    if (
      !refresh
      && existing?.note !== null
      && existing?.note !== undefined
      && existing.label !== null
      && sameSample(existing.sampledCommentFullnames, sampleFullnames)
      && (!apply || allAlreadyScored)
    ) {
      reused += 1;
      console.log(`[Member Mod Notes] ${progress} u/${member.username}: reuse ${comments.length}-comment assessment.`);
      if (apply) {
        const failures: string[] = [];
        for (const community of canonicalCommunities) {
          if (existing.appliedTo.some(value => value.toLowerCase() === community)) continue;
          try {
            await reddit.addModNote(community, member.username, existing.note, existing.label);
            await notes.markApplied(member.username, community);
            posted += 1;
          } catch (error) {
            failures.push(`r/${community}: ${safeError(error)}`);
          }
        }
        if (failures.length > 0) {
          failed += 1;
          await notes.failed(member.username, failures.join(' | '));
        }
      }
      continue;
    }

    const assessed: MemberCommentAssessment[] = [];
    for (const comment of [...comments].reverse()) {
      const classification = await classify(comment, member.username);
      assessed.push({ comment, classification });
      if (!apply || await reputation.hasContribution(comment.fullname)) continue;
      if (comment.author === null || comment.author.toLowerCase() !== member.username.toLowerCase()) continue;
      await reputation.applyModeration({
        fullname: comment.fullname,
        kind: 'comment',
        author: member.username,
        createdAt: comment.createdUtc,
        score: comment.score,
        permalink: comment.permalink,
        content: comment.body,
        classification,
        moderatedAt: Math.floor(Date.now() / 1_000),
      });
      scored += 1;
    }

    const profile = await assessor.assess(member.username, assessed);
    const current = await reputation.user(member.username);
    if (current === null) throw new Error(`Reputation member u/${member.username} disappeared during assessment`);
    const note = memberModNoteText(current.points, profile.summary);
    await notes.generated(
      member.username,
      note,
      profile.summary,
      profile.label,
      sampleFullnames,
      Math.floor(Date.now() / 1_000),
    );
    generated += 1;

    console.log(
      `[Member Mod Notes] ${progress} u/${member.username}: comments=${comments.length} score=${current.points} label=${profile.label}`,
    );

    if (!apply) continue;
    const failures: string[] = [];
    for (const community of canonicalCommunities) {
      try {
        await reddit.addModNote(community, member.username, note, profile.label);
        await notes.markApplied(member.username, community);
        posted += 1;
      } catch (error) {
        failures.push(`r/${community}: ${safeError(error)}`);
      }
    }
    if (failures.length > 0) {
      failed += 1;
      await notes.failed(member.username, failures.join(' | '));
    }
  } catch (error) {
    failed += 1;
    const message = safeError(error);
    await notes.failed(member.username, message);
    console.error(`[Member Mod Notes] ${progress} u/${member.username} failed: ${message}`);
  }
}

console.log(
  `[Member Mod Notes] complete members=${members.length} generated=${generated} reused=${reused} scored=${scored} posted=${posted} failed=${failed}`,
);
