import { QuestionEventStore } from '../src/questions/events.ts';
import {
  RedditQuestionRuntime,
  type QuestionRuntimeReader,
} from '../src/questions/runtime.ts';
import { QuestionStateStore, type QuestionStateRecord } from '../src/questions/state.ts';
import type { RedditComment } from '../src/reddit/types.ts';

const SYNTHETIC_AUTHOR = 'MaeSyntheticTest';
const normal = (value: string): string => value.trim().toLowerCase();

const state = new QuestionStateStore();
const events = new QuestionEventStore();
const selectedId = process.argv[2]?.trim() ?? null;

const syntheticCase2 = (question: QuestionStateRecord): boolean =>
  question.author === SYNTHETIC_AUTHOR
  && /^s[a-z0-9]+b$/iu.test(question.submissionId)
  && question.permalink === `/r/${question.subreddit}/comments/${question.submissionId}/synthetic_pipeline_test/`;

const currentQuestion = async (): Promise<QuestionStateRecord> => {
  if (selectedId !== null && selectedId.length > 0) {
    const selected = await state.question(selectedId);
    if (selected === null || !syntheticCase2(selected)) {
      throw new Error(`Synthetic Case 2 Question ${selectedId} is unavailable`);
    }
    if (selected.bestAnswerCommentId !== null) {
      throw new Error(`Synthetic Case 2 Question ${selectedId} is already resolved`);
    }
    return selected;
  }

  const candidates = (await state.all()).filter(question =>
    syntheticCase2(question) && question.bestAnswerCommentId === null);
  const question = candidates.at(-1) ?? null;
  if (question === null) {
    throw new Error('No unresolved synthetic Case 2 Question is available for !thankyou verification');
  }
  return question;
};

const lastSequence = async (): Promise<number> => {
  let cursor = 0;
  while (true) {
    const page = await events.after(cursor, 100);
    if (page.events.length === 0 || page.next === cursor) return cursor;
    cursor = page.next;
    if (page.events.length < 100) return cursor;
  }
};

const question = await currentQuestion();
if (!await state.activated(question.subreddit)) {
  throw new Error(`Production Question state is not activated for r/${question.subreddit}`);
}

console.log();
console.log('='.repeat(92));
console.log('CASE 8 - synthetic OP !thankyou resolves canonical Reddit Question state');
console.log('='.repeat(92));
console.log(`Synthetic Question: ${question.submissionId}`);
console.log(`Community         : r/${question.subreddit}`);

const answerId = `answer${question.submissionId}`;
const commandId = `thankyou${question.submissionId}`;
const now = Math.floor(Date.now() / 1_000);
let comments: readonly RedditComment[] = [{
  id: commandId,
  fullname: `t1_${commandId}`,
  subreddit: question.subreddit,
  submissionFullname: `t3_${question.submissionId}`,
  parentFullname: `t1_${answerId}`,
  submissionTitle: question.title,
  submissionAuthor: SYNTHETIC_AUTHOR,
  submissionPermalink: question.permalink,
  submissionFlairText: 'Question',
  author: SYNTHETIC_AUTHOR,
  body: '!thankyou',
  permalink: `${question.permalink.replace(/\/$/u, '')}/${commandId}/`,
  createdUtc: now,
  distinguished: null,
  stickied: false,
  removedByCategory: null,
  score: 1,
  mediaUrls: [],
}];

const reader: QuestionRuntimeReader = {
  newComments: async subreddit => normal(subreddit) === normal(question.subreddit) ? comments : [],
  moderators: async () => [],
};
const runtime = new RedditQuestionRuntime(
  [question.subreddit],
  reader,
  state,
  events,
);
const beforeEvents = await lastSequence();
const result = await runtime.tick();
comments = [];

if (result.resolved !== 1 || result.failed !== 0) {
  throw new Error(`!thankyou runtime result was resolved=${result.resolved} failed=${result.failed}`);
}

const selected = await state.question(question.submissionId);
if (selected?.bestAnswerCommentId !== answerId) {
  throw new Error('!thankyou did not persist the selected best-answer comment');
}

const emitted = (await events.after(beforeEvents, 100)).events.find(event =>
  event.kind === 'best_answer_selected'
  && event.submissionId === question.submissionId
  && event.selectionCommentId === commandId
  && event.answerCommentId === answerId) ?? null;
if (emitted === null) {
  throw new Error('!thankyou did not emit the canonical best_answer_selected event');
}

console.log('✅ Canonical best_answer_selected event emitted');
console.log('✅ Canonical best-answer state persisted');
console.log(`SYNTHETIC_THANKYOU_SUBMISSION=${question.submissionId}`);
console.log(`SYNTHETIC_THANKYOU_ANSWER=${answerId}`);
console.log('✅ CASE 8 Reddit phase passed');
