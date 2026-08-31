import 'dotenv/config';
import { resolve } from 'node:path';
import { redditModerationConfig } from '../src/env.ts';
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
import { snapshotCommentsForMember } from '../src/modnotes/snapshotComments.ts';
import { MemberModNoteStore, type MemberModNoteLabel } from '../src/modnotes/store.ts';
import { moderationHistoryFor } from '../src/reputation/moderationHistory.ts';
import { ReputationStore } from '../src/reputation/store.ts';
import type { RedditComment } from '../src/reddit/types.ts';

const onlyArg = process.argv.find(arg => arg.startsWith('--user='));
if (onlyArg === undefined) throw new Error('Usage: --user=<Reddit username>');
const requested = onlyArg.slice('--user='.length).trim();
if (requested.length === 0) throw new Error('Missing Reddit username');
if (process.env['MEMBER_MOD_NOTES_ISOLATED_RUN'] !== '1') {
  throw new Error('Snapshot fallback is allowed only inside an isolated member-note run');
}

const moderationCfg = redditModerationConfig();
if (moderationCfg === null) throw new Error('REDDIT_MODERATION_ENABLED must be true');
const reputation = new ReputationStore(moderationCfg.stateFile);
const raw = await reputation.raw();
const member = memberInventoryFromReputation(raw)
  .find(row => !row.moderator && row.username.toLowerCase() === requested.toLowerCase());
if (member === undefined) throw new Error(`No non-moderator reputation member found for u/${requested}`);

const notes = new MemberModNoteStore(resolve(
  process.cwd(),
  process.env['REDDIT_MEMBER_MOD_NOTES_FILE']?.trim() || 'data/memberModNotes.pb',
));
await notes.seed([member.username]);

const classifier = new RedditModerationClassifier(moderationCfg.ai);
const assessor = new MemberContributionAssessor(moderationCfg.ai);
const history = moderationHistoryFor(raw, member.username);
const comments = snapshotCommentsForMember(raw, member.username, 10);

const moderationItem = (comment: RedditComment): ModerationItem => ({
  kind: 'comment',
  subreddit: comment.subreddit,
  author: comment.author ?? '[deleted]',
  title: '',
  text: comment.body,
  permalink: comment.permalink,
  mediaUrls: comment.mediaUrls,
  history,
});

const labelText = (label: MemberModNoteLabel): string => {
  if (label === 'HELPFUL_USER') return 'Helpful';
  if (label === 'SOLID_CONTRIBUTOR') return 'Good Contributor';
  if (label === 'SPAM_WATCH') return 'Spam Watch';
  if (label === 'SPAM_WARNING') return 'Spam Warning';
  if (label === 'ABUSE_WARNING') return 'Abuse Warning';
  return 'No Label';
};

console.log('='.repeat(90));
console.log('MAE MEMBER MOD NOTES — SNAPSHOT FALLBACK');
console.log('='.repeat(90));
console.log(`Member: u/${member.username}`);
console.log(`Persisted eligible comments: ${comments.length}/10`);
console.log('Mode: PREVIEW ONLY — no Reddit reads, no Reddit writes, no reputation mutation');
console.log('='.repeat(90));

const assessed: MemberCommentAssessment[] = [];
for (const [offset, comment] of [...comments].reverse().entries()) {
  const classification: ModerationClassification = await classifier.classify(moderationItem(comment));
  assessed.push({ comment, classification });

  // These comments already exist in the canonical contribution ledger. They
  // are context for the member note, not new scoring events, so do not replay
  // their score effects during fallback completion.
  console.log('');
  console.log(`Persisted comment ${offset + 1}/${comments.length}: ${comment.fullname}`);
  console.log(`Community: r/${comment.subreddit}`);
  console.log(`Comment: ${comment.body.trim().length > 0 ? comment.body : '[empty comment]'}`);
  console.log(`Notes: ${classification.reason}`);
  console.log('Decision: CONTEXT ONLY — already present in reputation ledger');
}

let summary: string;
let selectedLabel: MemberModNoteLabel;
let confidence: number;
if (assessed.length === 0) {
  summary = 'No accessible or persisted qualifying comment history was available for this audit.';
  selectedLabel = 'NONE';
  confidence = 1;
} else {
  const profile = await assessor.assess(member.username, assessed);
  summary = profile.summary;
  selectedLabel = profile.label;
  confidence = profile.confidence;
}

// Snapshot fallback never creates new scoring events. The original audit
// baseline remains the score/status result for this otherwise inaccessible user.
const note = memberModNoteText(member.points, summary);
await notes.generated(
  member.username,
  note,
  summary,
  selectedLabel,
  comments.map(comment => comment.fullname),
  Math.floor(Date.now() / 1_000),
);

console.log('');
console.log('-'.repeat(90));
console.log(`USER RESULT 1/1: u/${member.username}`);
console.log(`Notes: ${summary}`);
console.log(`Score: ${member.points} -> ${member.points}`);
console.log(`Status: ${member.status} -> ${member.status}`);
console.log(`Tag: ${labelText(selectedLabel)} (${selectedLabel})`);
console.log(`Mod Note: ${note}`);
console.log(`Confidence: ${confidence.toFixed(3)}`);
console.log('-'.repeat(90));
