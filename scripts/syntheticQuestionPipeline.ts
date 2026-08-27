import 'dotenv/config';

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  redditConfig,
  redditModerationConfig,
} from '../src/env.ts';
import type {
  ModerationClassification,
  ModerationItem,
} from '../src/mod/classifier.ts';
import {
  OrganisingModerationClassifier,
  PostOrganisationRuntime,
  PostOrganisationStore,
  REPEATED_QUESTION_FLAIR_TEXT,
  type PostOrganisationPlan,
  type PostOrganisationReader,
  type PostOrganisationTick,
  type PostOrganisationWriter,
} from '../src/posts/organisation.ts';
import { QuestionEventStore, type QuestionEvent } from '../src/questions/events.ts';
import { RepeatedQuestionStore } from '../src/questions/repeats.ts';
import {
  RedditQuestionRuntime,
  type QuestionRuntimeReader,
  type QuestionRuntimeWriter,
} from '../src/questions/runtime.ts';
import { QuestionStateStore } from '../src/questions/state.ts';
import { RedditReadClient } from '../src/reddit/client.ts';
import type {
  RedditComment,
  RedditFlairTemplate,
} from '../src/reddit/types.ts';

const SYNTHETIC_AUTHOR = 'MaeSyntheticTest';
const hr = (): void => console.log('='.repeat(92));
const section = (name: string): void => {
  console.log();
  hr();
  console.log(name);
  hr();
};
const normal = (value: string): string => value.trim().toLowerCase();
const sleep = async (ms: number): Promise<void> =>
  await new Promise(resolveWait => setTimeout(resolveWait, ms));

const moderationCfg = redditModerationConfig();
if (moderationCfg === null) {
  throw new Error('Real Reddit moderation is disabled. Synthetic integration requires the production classifier.');
}

const redditCfg = redditConfig();
const liveReader = new RedditReadClient(redditCfg.auth);
const tempDir = await mkdtemp(join(tmpdir(), 'mae-question-pipeline-'));

const plans = new PostOrganisationStore(join(tempDir, 'postOrganisation.pb'));
const localState = new QuestionStateStore(join(tempDir, 'questionState.pb'));
const localEvents = new QuestionEventStore(join(tempDir, 'questionEvents.pb'));
const localRepeats = new RepeatedQuestionStore(join(tempDir, 'repeatedQuestions.pb'));

// These two production stores are deliberate. Discord consumes their events through
// the running Reddit internal API. Synthetic Question entries therefore remain as
// integration evidence, while all Reddit mutations are captured below.
const realState = new QuestionStateStore();
const realEvents = new QuestionEventStore();
const realRepeats = new RepeatedQuestionStore(join(tempDir, 'repeatedQuestions-real-path.pb'));

const syntheticRepeatedFlairs = new Map<string, RedditFlairTemplate>();
const submissionSubreddits = new Map<string, string>();

const organisationReader: PostOrganisationReader = {
  postFlairTemplates: async subreddit => {
    const live = await liveReader.postFlairTemplates(subreddit);
    const synthetic = syntheticRepeatedFlairs.get(normal(subreddit));
    if (synthetic === undefined) return live;
    if (live.some(value => normal(value.text) === normal(synthetic.text))) return live;
    return [...live, synthetic];
  },
};

const classifier = new OrganisingModerationClassifier(
  moderationCfg,
  organisationReader,
  plans,
);

type FlairWrite = {
  readonly subreddit: string;
  readonly submissionId: string;
  readonly templateId: string;
};
type FakePm = {
  readonly username: string;
  readonly subject: string;
  readonly body: string;
};
type FakeReply = {
  readonly parent: string;
  readonly body: string;
  readonly id: string;
  readonly fullname: string;
  readonly permalink: string;
};

const flairWrites: FlairWrite[] = [];
const pms: FakePm[] = [];
const replies: FakeReply[] = [];
const locks: string[] = [];
const unlocks: string[] = [];
const deletions: string[] = [];
const distinctions: Array<readonly [string, boolean]> = [];
let commentSequence = 0;

const submissionIdFromFullname = (fullname: string): string => {
  const match = /^t3_([A-Za-z0-9]+)$/u.exec(fullname);
  if (match === null) throw new Error(`Synthetic writer expected a submission fullname, got ${fullname}`);
  return match[1] ?? '';
};

const writer: PostOrganisationWriter & QuestionRuntimeWriter = {
  setPostFlairTemplate: async (subreddit, submissionId, templateId) => {
    flairWrites.push({ subreddit, submissionId, templateId });
  },
  sendPrivateMessage: async (username, subject, body) => {
    pms.push({ username, subject, body });
  },
  reply: async (fullname, body) => {
    const submissionId = submissionIdFromFullname(fullname);
    const subreddit = submissionSubreddits.get(submissionId) ?? 'synthetic';
    commentSequence += 1;
    const id = `maesyn${commentSequence}`;
    const created: FakeReply = {
      parent: fullname,
      body,
      id,
      fullname: `t1_${id}`,
      permalink: `/r/${subreddit}/comments/${submissionId}/synthetic_pipeline_test/${id}/`,
    };
    replies.push(created);
    return {
      id: created.id,
      fullname: created.fullname,
      permalink: created.permalink,
    };
  },
  lock: async fullname => {
    locks.push(fullname);
  },
  unlock: async fullname => {
    unlocks.push(fullname);
  },
  deleteContent: async fullname => {
    deletions.push(fullname);
  },
  distinguish: async (fullname, sticky = false) => {
    distinctions.push([fullname, sticky]);
  },
  createFlairTemplate: async (subreddit, kind, template) => {
    if (kind !== 'post') throw new Error('Repeated-question workflow unexpectedly requested a user flair');
    syntheticRepeatedFlairs.set(normal(subreddit), {
      ...template,
      id: `synthetic-repeat-${normal(subreddit)}`,
    });
  },
};

const syntheticModerationPersistence = {
  hasContribution: async (): Promise<boolean> => true,
};

type Scope = 'local' | 'real';
const stateFor = (scope: Scope): QuestionStateStore => scope === 'real' ? realState : localState;
const eventsFor = (scope: Scope): QuestionEventStore => scope === 'real' ? realEvents : localEvents;
const repeatsFor = (scope: Scope): RepeatedQuestionStore => scope === 'real' ? realRepeats : localRepeats;
const organiserFor = (scope: Scope): PostOrganisationRuntime =>
  new PostOrganisationRuntime(
    plans,
    syntheticModerationPersistence,
    organisationReader,
    writer,
    stateFor(scope),
    eventsFor(scope),
    repeatsFor(scope),
  );

const assignableFlairs = async (subreddit: string): Promise<readonly RedditFlairTemplate[]> =>
  (await liveReader.postFlairTemplates(subreddit)).filter(value => !value.modOnly);
const isQuestionFlair = (text: string): boolean => /^question(?:\s|$)/iu.test(text.trim());
const questionFlair = async (subreddit: string): Promise<RedditFlairTemplate> => {
  const value = (await assignableFlairs(subreddit)).find(flair => isQuestionFlair(flair.text));
  if (value === undefined) throw new Error(`No assignable Question flair exists in r/${subreddit}`);
  return value;
};
const ordinaryFlair = async (subreddit: string): Promise<RedditFlairTemplate> => {
  const values = await assignableFlairs(subreddit);
  const discussion = values.find(value => /^discussion(?:\s|$)/iu.test(value.text.trim()));
  if (discussion !== undefined) return discussion;
  const value = values.find(flair => !isQuestionFlair(flair.text));
  if (value === undefined) throw new Error(`No non-Question assignable flair exists in r/${subreddit}`);
  return value;
};

const lastSequence = async (store: QuestionEventStore): Promise<number> => {
  let cursor = 0;
  while (true) {
    const page = await store.after(cursor, 100);
    if (page.events.length === 0 || page.next === cursor) return cursor;
    cursor = page.next;
    if (page.events.length < 100) return cursor;
  }
};

const discordLog = resolve(process.cwd(), '..', 'discord', 'data', 'logs', 'reddit.log');
const discordText = async (): Promise<string> => {
  try {
    return await readFile(discordLog, 'utf8');
  } catch {
    return '';
  }
};
const waitForDiscord = async (
  start: number,
  marker: string,
  submissionId: string,
  timeoutMs = 50_000,
): Promise<boolean> => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const text = (await discordText()).slice(start);
    if (text.includes(marker) && text.includes(`/comments/${submissionId}/`)) return true;
    await sleep(2_000);
  }
  const text = (await discordText()).slice(start);
  return text.includes(marker) && text.includes(`/comments/${submissionId}/`);
};

const printClassification = (value: ModerationClassification): void => {
  console.log(`LLM disposition : ${value.disposition}`);
  console.log(`LLM verdict     : ${value.verdict}`);
  const organisation = value.postOrganisation ?? null;
  if (organisation === null) {
    console.log('Organisation    : NONE');
    return;
  }
  console.log(`Question        : ${organisation.isQuestion}`);
  console.log(`Flair target    : ${organisation.flairTemplateId}`);
  if (organisation.isQuestion) {
    console.log(`Canonical title : ${organisation.questionTitle}`);
    console.log(`Summary         : ${organisation.questionSummary}`);
  }
};

type TestCase = {
  readonly name: string;
  readonly id: string;
  readonly subreddit: string;
  readonly humanFlair: RedditFlairTemplate;
  readonly title: string;
  readonly body: string;
  readonly scope: Scope;
};
type Run = {
  readonly classification: ModerationClassification;
  readonly plan: PostOrganisationPlan | null;
  readonly tick: PostOrganisationTick | null;
  readonly events: readonly QuestionEvent[];
  readonly flairs: readonly FlairWrite[];
  readonly pms: readonly FakePm[];
  readonly replies: readonly FakeReply[];
  readonly locks: readonly string[];
};
type Result = {
  readonly name: string;
  readonly pass: boolean;
  readonly reason: string;
};

const runCase = async (test: TestCase): Promise<Run> => {
  section(test.name);
  submissionSubreddits.set(test.id, test.subreddit);
  console.log(`Synthetic post   : ${test.id}`);
  console.log(`Community        : r/${test.subreddit}`);
  console.log(`Human flair      : ${test.humanFlair.text}`);
  console.log(`Human title      : ${test.title}`);

  const beforeEvents = await lastSequence(eventsFor(test.scope));
  const beforeFlairs = flairWrites.length;
  const beforePms = pms.length;
  const beforeReplies = replies.length;
  const beforeLocks = locks.length;

  const permalink = `/r/${test.subreddit}/comments/${test.id}/synthetic_pipeline_test/`;
  const item: ModerationItem = {
    kind: 'post',
    subreddit: test.subreddit,
    author: SYNTHETIC_AUTHOR,
    title: test.title,
    text: test.body,
    permalink,
    mediaUrls: [],
    history: null,
  };
  const classification = await classifier.classify(item);
  printClassification(classification);

  const plan = (await plans.pending()).find(value => value.fullname === `t3_${test.id}`) ?? null;
  const tick = plan === null ? null : await organiserFor(test.scope).tick();
  if (tick !== null) {
    console.log(
      `Organiser       : questions=${tick.questions} duplicates=${tick.duplicates} failed=${tick.failed}`,
    );
  }

  const events = (await eventsFor(test.scope).after(beforeEvents, 100)).events
    .filter(event => event.submissionId === test.id);
  for (const event of events) console.log(`Event           : ${event.kind}`);

  return {
    classification,
    plan,
    tick,
    events,
    flairs: flairWrites.slice(beforeFlairs),
    pms: pms.slice(beforePms),
    replies: replies.slice(beforeReplies),
    locks: locks.slice(beforeLocks),
  };
};

const commandComment = (
  id: string,
  submissionId: string,
  parentId: string,
  author: string,
  body: string,
  createdUtc: number,
  subreddit: string,
): RedditComment => ({
  id,
  fullname: `t1_${id}`,
  subreddit,
  submissionFullname: `t3_${submissionId}`,
  parentFullname: `t1_${parentId}`,
  submissionTitle: 'Synthetic repeated question',
  submissionAuthor: SYNTHETIC_AUTHOR,
  submissionPermalink: `/r/${subreddit}/comments/${submissionId}/synthetic_pipeline_test/`,
  submissionFlairText: REPEATED_QUESTION_FLAIR_TEXT,
  author,
  body,
  permalink: `/r/${subreddit}/comments/${submissionId}/synthetic_pipeline_test/${id}/`,
  createdUtc,
  distinguished: null,
  stickied: false,
  removedByCategory: null,
  score: 1,
  mediaUrls: [],
});

const results: Result[] = [];
const record = (name: string, pass: boolean, reason: string): void => {
  results.push({ name, pass, reason });
  console.log(`${pass ? '✅' : '❌'} ${name}: ${reason}`);
};

try {
  section('LIVE FLAIR INVENTORY');
  for (const subreddit of ['catgirlcoin', 'nyaonearth']) {
    console.log(`r/${subreddit}`);
    for (const flair of await assignableFlairs(subreddit)) {
      console.log(`  ${flair.id} -> ${flair.text}`);
    }
  }

  const catQuestion = await questionFlair('catgirlcoin');
  const catOrdinary = await ordinaryFlair('catgirlcoin');
  const nyaQuestion = await questionFlair('nyaonearth');
  const nyaOrdinary = await ordinaryFlair('nyaonearth');
  const nonce = Date.now().toString(36);
  const marker = `QZB${nonce}`;

  const case1 = await runCase({
    name: 'CASE 1 - ordinary post with Question flair',
    id: `s${nonce}a`,
    subreddit: 'catgirlcoin',
    humanFlair: catQuestion,
    title: `${marker} deployment bulletin`,
    body: `Sharing the ${marker} deployment bulletin. This is an informational status update and not a request for help, advice, troubleshooting or an answer.`,
    scope: 'local',
  });
  record(
    'CASE 1',
    case1.classification.disposition === 'allow'
      && case1.classification.postOrganisation?.isQuestion === false
      && case1.plan?.isQuestion === false
      && case1.events.length === 0,
    'ordinary content stays outside Question lifecycle',
  );

  const case2Id = `s${nonce}b`;
  const case2DiscordStart = (await discordText()).length;
  const case2 = await runCase({
    name: 'CASE 2 - messy real Question to Discord',
    id: case2Id,
    subreddit: 'catgirlcoin',
    humanFlair: catOrdinary,
    title: `${marker} wallet cache thing need help`,
    body: `im trying to work out why the ${marker} NYA wallet cache keeps showing the previous chain balance after switching networks and i dont know whether clearing the cached rpc state is enough or whether the token has to be removed and added again`,
    scope: 'real',
  });
  const case2Discord = await waitForDiscord(case2DiscordStart, 'New question!', case2Id);
  record(
    'CASE 2',
    case2.classification.disposition === 'allow'
      && case2.classification.postOrganisation?.isQuestion === true
      && case2.tick?.questions === 1
      && case2.tick.duplicates === 0
      && case2.events.some(event => event.kind === 'question_opened')
      && case2Discord,
    'real LLM Question reaches the real Discord Question channel',
  );

  const canonical = await realState.question(case2Id);
  if (canonical === null) throw new Error('CASE 2 did not create canonical Question state');

  const case3Id = `s${nonce}c`;
  const case3DiscordStart = (await discordText()).length;
  const case3 = await runCase({
    name: 'CASE 3A - cross-community suspected repeat',
    id: case3Id,
    subreddit: 'nyaonearth',
    humanFlair: nyaOrdinary,
    title: canonical.title,
    body: `${canonical.summary} This is the same ${marker} underlying problem, asked from the other community.`,
    scope: 'real',
  });
  const repeat = await realRepeats.question(case3Id);
  const repeatReview = case3.events.find(event => event.kind === 'repeat_review_requested') ?? null;
  const case3Discord = await waitForDiscord(
    case3DiscordStart,
    'Potential repeated Reddit question',
    case3Id,
  );
  const phaseA = repeat !== null
    && repeat.status === 'pending'
    && repeat.matchedSubmissionId === case2Id
    && repeat.matchedSubreddit === 'catgirlcoin'
    && case3.tick?.duplicates === 1
    && case3.tick.questions === 0
    && case3.flairs.some(value => value.templateId === repeat.repeatedFlairTemplateId)
    && case3.replies.some(value => value.id === repeat.duplicateCommentId && value.body.includes('!false'))
    && case3.locks.includes(`t3_${case3Id}`)
    && case3.pms.some(value => value.username === SYNTHETIC_AUTHOR)
    && repeatReview !== null
    && !case3.events.some(event => event.kind === 'question_opened')
    && case3Discord;
  record('CASE 3A', phaseA, 'suspected repeat is quarantined and reaches real Discord moderator review');

  if (repeat === null || repeat.duplicateCommentId === null) {
    throw new Error('CASE 3A did not create the Mae duplicate notice required for !false testing');
  }
  if (!await realState.activated('nyaonearth')) {
    throw new Error('Production Question state is not activated for r/nyaonearth');
  }

  section('CASE 3B - synthetic moderator !false override');
  const moderators = await liveReader.moderators('nyaonearth');
  const moderator = moderators.find(value => value.name.trim().length > 0);
  if (moderator === undefined) throw new Error('r/nyaonearth returned no live moderators');
  let outsider = 'MaeSyntheticNonModerator';
  while (moderators.some(value => normal(value.name) === normal(outsider))) outsider += 'X';
  console.log(`Live moderator   : u/${moderator.name}`);
  console.log(`Negative actor   : u/${outsider}`);

  let comments: readonly RedditComment[] = [];
  const runtimeReader: QuestionRuntimeReader = {
    newComments: async subreddit => normal(subreddit) === 'nyaonearth' ? comments : [],
    moderators: async subreddit => await liveReader.moderators(subreddit),
  };
  const runtime = new RedditQuestionRuntime(
    ['nyaonearth'],
    runtimeReader,
    realState,
    realEvents,
    60_000,
    realRepeats,
    writer,
  );
  const now = Math.floor(Date.now() / 1_000);

  comments = [commandComment(
    `falseuser${case3Id}`,
    case3Id,
    repeat.duplicateCommentId,
    outsider,
    '!false',
    now,
    'nyaonearth',
  )];
  const outsiderResult = await runtime.tick();
  const outsiderBlocked = outsiderResult.repeatOverrides === 0
    && outsiderResult.ignored === 1
    && (await realRepeats.question(case3Id))?.status === 'pending';
  console.log(`${outsiderBlocked ? '✅' : '❌'} non-moderator !false rejected`);

  comments = [commandComment(
    `falsewrong${case3Id}`,
    case3Id,
    `wrong${case3Id}`,
    moderator.name,
    '!false',
    now + 1,
    'nyaonearth',
  )];
  const wrongParentResult = await runtime.tick();
  const wrongParentBlocked = wrongParentResult.repeatOverrides === 0
    && wrongParentResult.ignored === 1
    && (await realRepeats.question(case3Id))?.status === 'pending';
  console.log(`${wrongParentBlocked ? '✅' : '❌'} moderator !false with wrong parent rejected`);

  const beforeRestoreFlairs = flairWrites.length;
  const beforeUnlocks = unlocks.length;
  const beforeDeletions = deletions.length;
  const beforePms = pms.length;
  const beforeReplies = replies.length;
  const beforeDistinctions = distinctions.length;
  const beforeRestoreEvents = await lastSequence(realEvents);
  const restoreDiscordStart = (await discordText()).length;
  const validId = `falsevalid${case3Id}`;
  comments = [commandComment(
    validId,
    case3Id,
    repeat.duplicateCommentId,
    moderator.name,
    '  !FALSE  ',
    now + 2,
    'nyaonearth',
  )];
  const restoreResult = await runtime.tick();
  const finalRepeat = await realRepeats.question(case3Id);
  const finalQuestion = await realState.question(case3Id);
  const restoreEvents = (await realEvents.after(beforeRestoreEvents, 100)).events
    .filter(event => event.submissionId === case3Id);
  const restoreFlairs = flairWrites.slice(beforeRestoreFlairs);
  const restoreUnlocks = unlocks.slice(beforeUnlocks);
  const restoreDeletions = deletions.slice(beforeDeletions);
  const restorePms = pms.slice(beforePms);
  const restoreReplies = replies.slice(beforeReplies);
  const restoreDistinctions = distinctions.slice(beforeDistinctions);
  const restoredDiscord = await waitForDiscord(restoreDiscordStart, 'New question!', case3Id);

  const phaseB = outsiderBlocked
    && wrongParentBlocked
    && restoreResult.repeatOverrides === 1
    && restoreResult.failed === 0
    && finalRepeat?.status === 'overturned'
    && finalRepeat.falseCommandId === validId
    && normal(finalRepeat.reviewedBy ?? '') === normal(moderator.name)
    && finalRepeat.questionFlairRestored
    && finalRepeat.unlocked
    && finalRepeat.duplicateCommentDeleted
    && finalRepeat.apologySent
    && finalRepeat.questionOpened
    && await realRepeats.bypassed(case3Id)
    && restoreFlairs.some(value => value.templateId === repeat.questionFlairTemplateId)
    && restoreUnlocks.includes(`t3_${case3Id}`)
    && restoreDeletions.includes(`t1_${repeat.duplicateCommentId}`)
    && restorePms.some(value => value.subject === 'Mae repeat review' && value.body.includes('not a repeat'))
    && restoreReplies.some(value => value.parent === `t3_${case3Id}`)
    && restoreDistinctions.some(value => value[1] === true)
    && finalQuestion?.openedHandled === true
    && finalQuestion.acknowledgementCommentId !== null
    && restoreEvents.some(event => event.kind === 'question_opened')
    && restoredDiscord;
  record('CASE 3B', phaseB, 'only a real current moderator direct-reply !false restores the Question and reaches Discord');

  const case4 = await runCase({
    name: 'CASE 4 - clear Question with wrong flair',
    id: `s${nonce}d`,
    subreddit: 'catgirlcoin',
    humanFlair: catOrdinary,
    title: `Where should the KITE${nonce} runtime fingerprint be compared?`,
    body: `I have a KITE${nonce} runtime bytecode hash and a metadata hash. Which value should I compare to establish that deployed runtime code is equivalent?`,
    scope: 'local',
  });
  record(
    'CASE 4',
    case4.classification.postOrganisation?.isQuestion === true
      && case4.tick?.questions === 1
      && case4.events.some(event => event.kind === 'question_opened'),
    'clear Question is canonicalised despite wrong human flair',
  );

  const case5 = await runCase({
    name: 'CASE 5 - messy Question with correct flair and no question mark',
    id: `s${nonce}e`,
    subreddit: 'nyaonearth',
    humanFlair: nyaQuestion,
    title: `EMBER${nonce} wallet cache after switching chains`,
    body: `wallet keeps showing an older NYA balance after i switch networks and im trying to figure out whether clearing the EMBER${nonce} cached rpc state is enough or whether the token needs to be removed and added again`,
    scope: 'local',
  });
  record(
    'CASE 5',
    case5.classification.postOrganisation?.isQuestion === true
      && case5.plan?.targetFlairTemplateId === nyaQuestion.id
      && case5.tick?.questions === 1,
    'correct human Question flair is preserved because semantic classification agrees',
  );

  const case6 = await runCase({
    name: 'CASE 6 - question mark but semantically not a Question',
    id: `s${nonce}f`,
    subreddit: 'nyaonearth',
    humanFlair: nyaQuestion,
    title: `ORBIT${nonce} benchmark faster today?`,
    body: `Benchmark report for ORBIT${nonce}: endpoint latency dropped from 410 ms to 265 ms after the cache change. This is a status update and I am not asking for information, help, advice or an answer.`,
    scope: 'local',
  });
  record(
    'CASE 6',
    case6.classification.postOrganisation?.isQuestion === false
      && case6.plan?.isQuestion === false
      && case6.events.length === 0,
    'punctuation alone cannot manufacture Question state',
  );

  const case7 = await runCase({
    name: 'CASE 7 - question-shaped scam',
    id: `s${nonce}g`,
    subreddit: 'nyaonearth',
    humanFlair: nyaQuestion,
    title: 'Need help claiming the guaranteed NYA doubling reward?',
    body: `Connect your wallet at https://claim-${nonce}.invalid and approve the unlimited token allowance. Your NYA balance will then be doubled instantly. The guaranteed reward expires today, so approve the wallet transaction immediately.`,
    scope: 'local',
  });
  record(
    'CASE 7',
    case7.classification.disposition === 'remove'
      && case7.plan === null
      && case7.events.length === 0,
    'moderation removal stops the post before organisation and Question routing',
  );

  section('FINAL SYNTHETIC QUESTION PIPELINE REPORT');
  for (const result of results) {
    console.log(`${result.pass ? '✅' : '❌'} ${result.name} - ${result.reason}`);
  }
  const failed = results.filter(result => !result.pass);
  console.log();
  console.log(failed.length === 0
    ? 'OVERALL: ✅ ALL SYNTHETIC PIPELINE CHECKS PASSED'
    : `OVERALL: ❌ ${failed.length} CHECK(S) FAILED`);
  console.log('REAL REDDIT MUTATIONS PERFORMED: NONE');
  console.log('CASE 2 and CASE 3 Question events intentionally remain in production Question event/state history.');
  console.log('The corresponding Discord messages intentionally remain as integration evidence.');
  process.exitCode = failed.length === 0 ? 0 : 2;
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
