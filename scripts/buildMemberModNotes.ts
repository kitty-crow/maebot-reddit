import 'dotenv/config';
import { resolve } from 'node:path';
import { redditConfig, redditModerationConfig } from '../src/env.ts';
import {
  RedditModerationClassifier,
  type ModerationClassification,
  type ModerationItem,
} from '../src/mod/classifier.ts';
import {
  MemberContributionAssessor,
  memberModNoteText,
  type MemberCommentAssessment,
} from '../src/modnotes/assessor.ts';
import { memberInventoryFromReputation } from '../src/modnotes/inventory.ts';
import { MemberModNotesRedditClient } from '../src/modnotes/reddit.ts';
import { MemberModNoteStore, type MemberModNoteLabel } from '../src/modnotes/store.ts';
import { moderationHistoryFor } from '../src/reputation/moderationHistory.ts';
import { applyModerationClassification, type ReputationSubject } from '../src/reputation/runtimePolicy.ts';
import { ReputationStore } from '../src/reputation/store.ts';
import { safeError } from '../src/reddit/error.ts';
import type { RedditComment } from '../src/reddit/types.ts';

const canonicalCommunities = ['catgirlcoin', 'nyaonearth'] as const;
const apply = process.argv.includes('--apply');
const refresh = process.argv.includes('--refresh');
const onlyArg = process.argv.find(arg => arg.startsWith('--user='));
const onlyUser = onlyArg === undefined ? null : onlyArg.slice('--user='.length).trim().toLowerCase();
const isolatedRun = process.env['MEMBER_MOD_NOTES_ISOLATED_RUN'] === '1';
const liveApply = process.env['MEMBER_MOD_NOTES_LIVE_APPLY'] === '1';

if (apply && !isolatedRun && !liveApply) {
  throw new Error(
    'Live member Mod Notes apply requires MEMBER_MOD_NOTES_LIVE_APPLY=1. Use the isolated tmux launcher for experiments.',
  );
}

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
const members = inventory.filter(user =>
  !user.moderator && (onlyUser === null || user.username.toLowerCase() === onlyUser));
if (onlyUser !== null && members.length === 0) {
  throw new Error(`No non-moderator reputation member found for u/${onlyUser}`);
}
await notes.seed(members.map(user => user.username));

const moderationItem = (
  comment: RedditComment,
  history: ReturnType<typeof moderationHistoryFor>,
): ModerationItem => ({
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

const progressBar = (fraction: number, width = 32): string => {
  const safe = Math.max(0, Math.min(1, fraction));
  const filled = Math.round(safe * width);
  return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}] ${(safe * 100).toFixed(1).padStart(5)}%`;
};

const overallFraction = (
  userIndex: number,
  userCount: number,
  commentIndex: number,
  commentCount: number,
): number => {
  if (userCount <= 0) return 1;
  const withinUser = commentCount <= 0 ? 1 : Math.max(0, Math.min(1, commentIndex / commentCount));
  return Math.max(0, Math.min(1, (userIndex + withinUser) / userCount));
};

const labelText = (label: MemberModNoteLabel): string => {
  if (label === 'HELPFUL_USER') return 'Helpful';
  if (label === 'SOLID_CONTRIBUTOR') return 'Good Contributor';
  if (label === 'SPAM_WATCH') return 'Spam Watch';
  if (label === 'SPAM_WARNING') return 'Spam Warning';
  if (label === 'ABUSE_WARNING') return 'Abuse Warning';
  return 'No Label';
};

const replaceNativeNote = async (
  community: string,
  username: string,
  note: string,
  label: MemberModNoteLabel,
  redditId?: string,
): Promise<void> => {
  const previous = await notes.record(username);
  const oldId = previous?.nativeNotes.find(entry => entry.subreddit.toLowerCase() === community.toLowerCase())?.noteId ?? null;
  const newId = await reddit.addModNote(community, username, note, label, redditId);
  await notes.markNativeNote(username, community, newId);
  await notes.markApplied(username, community);
  if (oldId !== null && oldId !== newId) await reddit.deleteModNote(community, username, oldId);
};

const decisionText = (
  before: ReputationSubject,
  after: ReputationSubject & { readonly ban?: boolean },
  classification: ModerationClassification,
  alreadyScored: boolean,
): string => {
  if (alreadyScored) return 'already scored earlier; no reputation change';
  if (after.ban === true) return `BAN (${classification.verdict}, ${classification.rule})`;
  const delta = after.points - before.points;
  if (delta > 0) return `UP SCORE +${delta} (${classification.verdict})`;
  if (delta < 0) return `LOWER SCORE ${delta} (${classification.verdict}, ${classification.rule})`;
  if (classification.disposition === 'remove') return `REMOVE, score unchanged (${classification.verdict}, ${classification.rule})`;
  return `NO SCORE CHANGE (${classification.verdict})`;
};

const printCommentResult = (
  userIndex: number,
  userCount: number,
  username: string,
  commentIndex: number,
  commentCount: number,
  comment: RedditComment,
  classification: ModerationClassification,
  before: ReputationSubject,
  after: ReputationSubject & { readonly ban?: boolean },
  alreadyScored: boolean,
): void => {
  const fraction = overallFraction(userIndex, userCount, commentIndex, commentCount);
  console.log('');
  console.log(`${progressBar(fraction)}  user ${userIndex + 1}/${userCount}: u/${username}  comment ${commentIndex}/${commentCount}`);
  console.log(`Community: r/${comment.subreddit}`);
  console.log(`Reddit item: ${comment.fullname}  created=${new Date(comment.createdUtc * 1_000).toISOString()}`);
  console.log('Comment:');
  console.log(comment.body.trim().length > 0 ? comment.body : '[empty comment]');
  console.log(`Notes: ${classification.reason}`);
  if (classification.evidence.length > 0) console.log(`Evidence: ${classification.evidence.join(' | ')}`);
  console.log(`Score: ${before.points} -> ${after.points}`);
  console.log(`Status: ${before.status} -> ${after.status}`);
  console.log(`Decision: ${decisionText(before, after, classification, alreadyScored)}`);
};

let generated = 0;
let reused = 0;
let scored = 0;
let posted = 0;
let failed = 0;

console.log('='.repeat(90));
console.log('MAE MEMBER MOD NOTES EXPERIMENT');
console.log('='.repeat(90));
console.log(`Members: ${members.length}`);
console.log(`Mode: ${apply ? (liveApply ? 'LIVE AUDIT APPLY' : 'ISOLATED APPLY') : 'PREVIEW'}`);
console.log(`Communities: ${canonicalCommunities.map(value => `r/${value}`).join(' + ')}`);
console.log(`Member note store: ${process.env['REDDIT_MEMBER_MOD_NOTES_FILE']?.trim() || 'data/memberModNotes.pb'}`);
if (apply) {
  console.log('APPLY mode: untracked sampled comments update reputation scores, then the tracked native Mod Note/tag is replaced in both communities.');
} else {
  console.log('PREVIEW mode: reputation changes are simulated and memberModNotes.pb is written; Reddit and reputation.pb are not mutated.');
}
console.log('='.repeat(90));

for (let index = 0; index < members.length; index += 1) {
  const member = members[index];
  if (member === undefined) continue;
  const progress = `${index + 1}/${members.length}`;
  try {
    console.log('');
    console.log('='.repeat(90));
    console.log(`${progressBar(overallFraction(index, members.length, 0, 1))}  CURRENT USER ${progress}: u/${member.username}`);
    console.log('Fetching the 10 most recent comments across the two moderated communities...');

    const comments = await reddit.recentCommentsInCommunities(member.username, canonicalCommunities, 10, 1_000);
    const sampleFullnames = comments.map(comment => comment.fullname);
    const existing = await notes.record(member.username);
    const currentBefore = await reputation.user(member.username);
    if (currentBefore === null) {
      throw new Error(`Reputation member u/${member.username} disappeared before assessment`);
    }
    const currentScorePrefix = `Mae score: ${currentBefore.points}. `;
    const allAlreadyScored = apply
      ? (await Promise.all(comments.map(comment => reputation.hasContribution(comment.fullname)))).every(Boolean)
      : false;

    if (
      apply
      && !refresh
      && allAlreadyScored
      && existing !== null
      && existing.note !== null
      && existing.label !== null
      && existing.note.startsWith(currentScorePrefix)
      && sameSample(existing.sampledCommentFullnames, sampleFullnames)
    ) {
      reused += 1;
      console.log(`Sample unchanged and all ${comments.length} comments are already scored. Reusing stored assessment.`);
      console.log(`Notes: ${existing.summary ?? existing.note}`);
      console.log(`Score: ${currentBefore.points}`);
      console.log(`Status: ${currentBefore.status}`);
      console.log(`Tag: ${labelText(existing.label)}`);
      console.log(`Mod Note: ${existing.note}`);

      const failures: string[] = [];
      for (const community of canonicalCommunities) {
        const hasNative = existing.nativeNotes.some(entry => entry.subreddit.toLowerCase() === community);
        if (existing.appliedTo.some(value => value.toLowerCase() === community) && hasNative) {
          console.log(`Reddit: r/${community} already has the tracked current Mae note.`);
          continue;
        }
        try {
          console.log(`Reddit: replacing native Mod Note in r/${community}...`);
          await replaceNativeNote(community, member.username, existing.note, existing.label, sampleFullnames[0]);
          posted += 1;
          console.log(`Reddit: current Mae note installed in r/${community}.`);
        } catch (error) {
          failures.push(`r/${community}: ${safeError(error)}`);
        }
      }
      if (failures.length > 0) {
        failed += 1;
        await notes.failed(member.username, failures.join(' | '));
      }
      console.log(`${progressBar(overallFraction(index + 1, members.length, 0, 1))}  completed u/${member.username}`);
      continue;
    }

    console.log(`Found ${comments.length}/10 qualifying comments. Starting Mae moderation assessment.`);
    const assessed: MemberCommentAssessment[] = [];
    let projected: ReputationSubject = {
      points: currentBefore.points,
      status: currentBefore.status,
    };
    const chronological = [...comments].reverse();

    for (let commentOffset = 0; commentOffset < chronological.length; commentOffset += 1) {
      const comment = chronological[commentOffset];
      if (comment === undefined) continue;
      const commentNumber = commentOffset + 1;
      console.log('');
      console.log(`${progressBar(overallFraction(index, members.length, commentOffset, chronological.length))}  user ${progress}: u/${member.username}`);
      console.log(`Checking comment ${commentNumber}/${chronological.length} with Mae...`);
      console.log(`Comment: ${comment.body.trim().length > 0 ? comment.body : '[empty comment]'}`);
      console.log('LLM: analysing...');

      const classification = await classify(comment, member.username);
      assessed.push({ comment, classification });
      const alreadyScored = await reputation.hasContribution(comment.fullname);
      const before: ReputationSubject = apply
        ? (() => {
            const value = projected;
            return { points: value.points, status: value.status };
          })()
        : { points: projected.points, status: projected.status };

      let after: ReputationSubject & { readonly ban?: boolean };
      if (alreadyScored) {
        after = { points: before.points, status: before.status, ban: false };
      } else if (apply) {
        if (comment.author === null || comment.author.toLowerCase() !== member.username.toLowerCase()) {
          throw new Error(`Reddit comment ${comment.fullname} no longer belongs to u/${member.username}`);
        }
        const next = await reputation.applyModeration({
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
        after = {
          points: next.points,
          status: next.status,
          ban: next.status === 'banned' || next.status === 'scam',
        };
        scored += 1;
      } else {
        const transition = applyModerationClassification(projected, classification);
        after = {
          points: transition.points,
          status: transition.status,
          ban: transition.ban,
        };
      }
      projected = { points: after.points, status: after.status };
      printCommentResult(
        index,
        members.length,
        member.username,
        commentNumber,
        chronological.length,
        comment,
        classification,
        before,
        after,
        alreadyScored,
      );
    }

    console.log('');
    console.log('Summarising this member across the combined comment sample...');
    const profile = await assessor.assess(member.username, assessed);
    const finalState = apply ? await reputation.user(member.username) : null;
    if (apply && finalState === null) {
      throw new Error(`Reputation member u/${member.username} disappeared during assessment`);
    }
    const finalPoints = finalState?.points ?? projected.points;
    const finalStatus = finalState?.status ?? projected.status;
    const note = memberModNoteText(finalPoints, profile.summary);
    await notes.generated(
      member.username,
      note,
      profile.summary,
      profile.label,
      sampleFullnames,
      Math.floor(Date.now() / 1_000),
    );
    generated += 1;

    console.log('');
    console.log('-'.repeat(90));
    console.log(`USER RESULT ${progress}: u/${member.username}`);
    console.log(`Notes: ${profile.summary}`);
    console.log(`Score: ${currentBefore.points} -> ${finalPoints}`);
    console.log(`Status: ${currentBefore.status} -> ${finalStatus}`);
    console.log(`Tag: ${labelText(profile.label)} (${profile.label})`);
    console.log(`Mod Note: ${note}`);
    console.log(`Confidence: ${profile.confidence.toFixed(3)}`);
    console.log('-'.repeat(90));

    if (apply) {
      const failures: string[] = [];
      for (const community of canonicalCommunities) {
        try {
          console.log(`Reddit: replacing native Mod Note in r/${community}...`);
          await replaceNativeNote(community, member.username, note, profile.label, sampleFullnames[0]);
          posted += 1;
          console.log(`Reddit: current Mae note installed in r/${community}.`);
        } catch (error) {
          failures.push(`r/${community}: ${safeError(error)}`);
        }
      }
      if (failures.length > 0) {
        failed += 1;
        await notes.failed(member.username, failures.join(' | '));
      }
    }

    console.log(`${progressBar(overallFraction(index + 1, members.length, 0, 1))}  completed u/${member.username}`);
  } catch (error) {
    failed += 1;
    const message = safeError(error);
    await notes.failed(member.username, message);
    console.error(`[Member Mod Notes] ${progress} u/${member.username} failed: ${message}`);
  }
}

console.log('');
console.log('='.repeat(90));
console.log(`${progressBar(1)}  COMPLETE`);
console.log(`members=${members.length} generated=${generated} reused=${reused} scored=${scored} posted=${posted} failed=${failed}`);
console.log('='.repeat(90));
