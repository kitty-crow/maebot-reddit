import { parse as parseDotenv } from 'dotenv';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { QuestionEventStore } from '../src/questions/events.ts';
import {
  RedditQuestionRuntime,
  type QuestionRuntimeReader,
} from '../src/questions/runtime.ts';
import { QuestionStateStore, type QuestionStateRecord } from '../src/questions/state.ts';
import type { RedditComment } from '../src/reddit/types.ts';
import { isMap, parseJson } from '../src/types/json.ts';

const SYNTHETIC_AUTHOR = 'MaeSyntheticTest';
const questionFooterPrefix = 'Mae Reddit question · ';
const sleep = async (ms: number): Promise<void> =>
  await new Promise(resolveWait => setTimeout(resolveWait, ms));
const normal = (value: string): string => value.trim().toLowerCase();

const requireEnv = (values: Readonly<Record<string, string>>, key: string): string => {
  const value = values[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Discord integration environment is missing ${key}`);
  }
  return value.trim();
};

const discordEnv = parseDotenv(
  await readFile(resolve(process.cwd(), '..', 'discord', '.env'), 'utf8'),
);
const discordToken = requireEnv(discordEnv, 'DISCORD_MAE_TOKEN');
const discordQuestionChannel = requireEnv(discordEnv, 'DISCORD_REDDIT_CHANNEL_ID');

const state = new QuestionStateStore();
const events = new QuestionEventStore();

const currentSyntheticQuestion = async (): Promise<QuestionStateRecord> => {
  const candidates = (await state.all()).filter(question =>
    question.author === SYNTHETIC_AUTHOR
    && /^s[a-z0-9]+b$/iu.test(question.submissionId)
    && question.permalink === `/r/${question.subreddit}/comments/${question.submissionId}/synthetic_pipeline_test/`
    && question.bestAnswerCommentId === null);
  const question = candidates.at(-1) ?? null;
  if (question === null) {
    throw new Error('No unresolved synthetic Case 2 Question is available for !thankyou verification');
  }
  return question;
};

type DiscordQuestionCard = {
  readonly id: string;
  readonly reactions: ReadonlySet<string>;
};

const reactionNames = (raw: object): ReadonlySet<string> => {
  if (!isMap(raw)) return new Set<string>();
  const reactions = raw['reactions'];
  if (!Array.isArray(reactions)) return new Set<string>();
  const names = new Set<string>();
  for (const reaction of reactions) {
    if (!isMap(reaction)) continue;
    const emoji = reaction['emoji'];
    if (!isMap(emoji)) continue;
    const name = emoji['name'];
    if (typeof name === 'string' && name.length > 0) names.add(name);
  }
  return names;
};

const footerText = (raw: object): string | null => {
  if (!isMap(raw)) return null;
  const embeds = raw['embeds'];
  if (!Array.isArray(embeds)) return null;
  for (const embed of embeds) {
    if (!isMap(embed)) continue;
    const footer = embed['footer'];
    if (!isMap(footer)) continue;
    const text = footer['text'];
    if (typeof text === 'string' && text.length > 0) return text;
  }
  return null;
};

const discordQuestionCard = async (submissionId: string): Promise<DiscordQuestionCard | null> => {
  const response = await fetch(
    `https://discord.com/api/v10/channels/${discordQuestionChannel}/messages?limit=100`,
    {
      headers: {
        authorization: `Bot ${discordToken}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Discord Question inspection failed with HTTP ${response.status}`);
  }
  const body = parseJson(await response.text());
  if (!Array.isArray(body)) throw new Error('Discord Question inspection returned a non-list response');
  const expectedFooter = `${questionFooterPrefix}${submissionId}`;
  for (const raw of body) {
    if (!isMap(raw) || footerText(raw) !== expectedFooter) continue;
    const id = raw['id'];
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('Discord Question card is missing its message ID');
    }
    return {
      id,
      reactions: reactionNames(raw),
    };
  }
  return null;
};

const waitForReactionState = async (
  submissionId: string,
  expected: (card: DiscordQuestionCard) => boolean,
  timeoutMs = 50_000,
): Promise<DiscordQuestionCard> => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const card = await discordQuestionCard(submissionId);
    if (card !== null && expected(card)) return card;
    await sleep(2_000);
  }
  const card = await discordQuestionCard(submissionId);
  if (card !== null && expected(card)) return card;
  throw new Error(`Discord Question ${submissionId} did not reach the expected reaction state`);
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

const question = await currentSyntheticQuestion();
if (!await state.activated(question.subreddit)) {
  throw new Error(`Production Question state is not activated for r/${question.subreddit}`);
}

console.log();
console.log('='.repeat(92));
console.log('CASE 8 - synthetic OP !thankyou resolves Question and changes live Discord reaction');
console.log('='.repeat(92));
console.log(`Synthetic Question: ${question.submissionId}`);
console.log(`Community         : r/${question.subreddit}`);

const beforeCard = await waitForReactionState(
  question.submissionId,
  card => card.reactions.has('🔥') && !card.reactions.has('✅'),
);
console.log(`✅ Before !thankyou Discord message ${beforeCard.id} has 🔥 and no ✅`);

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
  body: '  !thankyou  ',
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
if (emitted === null) throw new Error('!thankyou did not emit the canonical best_answer_selected event');
console.log('✅ Canonical best_answer_selected event emitted');

const afterCard = await waitForReactionState(
  question.submissionId,
  card => card.reactions.has('✅') && !card.reactions.has('🔥'),
);
if (afterCard.id !== beforeCard.id) {
  throw new Error('Discord replaced the Question card instead of resolving the existing card');
}
console.log(`✅ After !thankyou Discord message ${afterCard.id} has ✅ and no 🔥`);
console.log('✅ CASE 8 passed: real Question lifecycle + live Discord reaction transition verified');
