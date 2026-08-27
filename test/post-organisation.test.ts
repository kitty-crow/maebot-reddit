import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RedditModerationCfg } from '../src/env.ts';
import type {
  ModerationClassification,
  ModerationClassifier,
  ModerationItem,
  ModerationPostOrganisation,
} from '../src/mod/classifier.ts';
import {
  OrganisingModerationClassifier,
  PostOrganisationRuntime,
  PostOrganisationStore,
  REPEATED_QUESTION_FLAIR_TEXT,
  type PostOrganisationReader,
  type PostOrganisationReputation,
  type PostOrganisationWriter,
} from '../src/posts/organisation.ts';
import { QuestionEventStore } from '../src/questions/events.ts';
import { RepeatedQuestionStore } from '../src/questions/repeats.ts';
import { QuestionStateStore } from '../src/questions/state.ts';
import type { RedditFlairTemplate } from '../src/reddit/types.ts';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(async dir => await rm(dir, { recursive: true, force: true })));
});

const temp = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'maebot-reddit-post-organisation-'));
  dirs.push(dir);
  return dir;
};

const cfg: RedditModerationCfg = {
  ai: { key: 'test', model: 'gpt-5.6-luna', effort: 'low' },
  stateFile: '/tmp/reputation.pb',
  batchSize: 100,
  scoreBatchSize: 100,
  flairReconcileMs: 300_000,
};

const flair = (id: string, text: string, modOnly = false): RedditFlairTemplate => ({
  id,
  text,
  cssClass: null,
  textColour: null,
  backgroundColour: null,
  modOnly,
  textEditable: false,
  allowableContent: 'all',
  maxEmojis: null,
});

const post = (overrides: Partial<ModerationItem> = {}): ModerationItem => ({
  kind: 'post',
  subreddit: 'nyaonearth',
  author: 'Alice',
  title: 'uh so bridge thing, help',
  text: 'I have NYA on Ethereum and I am trying to get it onto Base but I am confused about the supported route.',
  permalink: '/r/nyaonearth/comments/new123/uh_so_bridge_thing_help/',
  mediaUrls: [],
  history: null,
  ...overrides,
});

const clean = (organisation: ModerationPostOrganisation | null): ModerationClassification => ({
  verdict: 'clean',
  rule: 'none',
  disposition: 'allow',
  penaltyPoints: 0,
  confidence: 0.99,
  reason: 'Allowed.',
  evidence: [],
  postOrganisation: organisation,
});

const basicReader = (values: RedditFlairTemplate[]): PostOrganisationReader => ({
  postFlairTemplates: async () => values,
});

type WriterTrace = {
  readonly flairs: Array<readonly [string, string, string]>;
  readonly messages: Array<readonly [string, string, string]>;
  readonly replies: Array<readonly [string, string]>;
  readonly locks: string[];
  readonly distinguished: Array<readonly [string, boolean]>;
  readonly createdFlairs: string[];
};

const writer = (templates: RedditFlairTemplate[], trace: WriterTrace): PostOrganisationWriter => ({
  setPostFlairTemplate: async (subreddit, submissionId, templateId) => {
    trace.flairs.push([subreddit, submissionId, templateId]);
  },
  sendPrivateMessage: async (username, subject, body) => {
    trace.messages.push([username, subject, body]);
  },
  reply: async (fullname, body) => {
    trace.replies.push([fullname, body]);
    const id = `mae${trace.replies.length}`;
    const submission = fullname.replace(/^t3_/u, '');
    return {
      id,
      fullname: `t1_${id}`,
      permalink: `/r/nyaonearth/comments/${submission}/question/${id}/`,
    };
  },
  lock: async fullname => {
    trace.locks.push(fullname);
  },
  distinguish: async (fullname, sticky = false) => {
    trace.distinguished.push([fullname, sticky]);
  },
  createFlairTemplate: async (_subreddit, kind, template) => {
    expect(kind).toBe('post');
    trace.createdFlairs.push(template.text);
    templates.push({ ...template, id: 'repeat-flair' });
  },
});

const emptyTrace = (): WriterTrace => ({
  flairs: [],
  messages: [],
  replies: [],
  locks: [],
  distinguished: [],
  createdFlairs: [],
});

describe('moderation-owned Reddit post organisation', () => {
  test('uses one classification call, exposes live semantic flairs, and never plans removed posts', async () => {
    const dir = await temp();
    const plans = new PostOrganisationStore(join(dir, 'plans.pb'));
    const inventories: string[] = [];
    const reader: PostOrganisationReader = {
      postFlairTemplates: async subreddit => {
        inventories.push(subreddit);
        return [
          flair('question', 'Question :hana:'),
          flair('discussion', 'Discussion'),
          flair('news', 'News'),
          flair('repeat', REPEATED_QUESTION_FLAIR_TEXT, true),
          flair('mod-announcement', 'Announcement :catgirl-moon:', true),
        ];
      },
    };

    const seen: ModerationItem[] = [];
    let response = clean({
      flairTemplateId: 'question',
      isQuestion: true,
      questionTitle: 'How can I bridge NYA from Ethereum to Base?',
      questionSummary: 'The OP has NYA on Ethereum and wants the supported route to Base.',
      confidence: 0.97,
    });
    const inner: ModerationClassifier = {
      classify: async item => {
        seen.push(item);
        return response;
      },
    };
    const classifier = new OrganisingModerationClassifier(cfg, reader, plans, 300_000, inner);

    const result = await classifier.classify(post());
    expect(result.disposition).toBe('allow');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.postFlairs).toEqual([
      { id: 'question', text: 'Question :hana:' },
      { id: 'discussion', text: 'Discussion' },
      { id: 'news', text: 'News' },
    ]);
    expect(inventories).toEqual(['nyaonearth']);
    expect(await plans.pending()).toMatchObject([{
      fullname: 't3_new123',
      targetFlairTemplateId: 'question',
      isQuestion: true,
      questionTitle: 'How can I bridge NYA from Ethereum to Base?',
    }]);

    response = {
      verdict: 'severe',
      rule: 'rule_6',
      disposition: 'remove',
      penaltyPoints: 10,
      confidence: 0.99,
      reason: 'Remove.',
      evidence: [],
      postOrganisation: null,
    };
    await classifier.classify(post({ permalink: '/r/nyaonearth/comments/bad999/remove_me/' }));
    expect(seen).toHaveLength(2);
    expect(await plans.pending()).toHaveLength(1);
  });

  test('cross-community cosine repeats are flaired, commented, locked, PMed and emitted for moderator review', async () => {
    const dir = await temp();
    const plans = new PostOrganisationStore(join(dir, 'plans.pb'));
    const questions = new QuestionStateStore(join(dir, 'questions.pb'));
    const events = new QuestionEventStore(join(dir, 'events.pb'));
    const repeats = new RepeatedQuestionStore(join(dir, 'repeats.pb'));
    const templates = [
      flair('question', 'Question :hana:'),
      flair('discussion', 'Discussion'),
    ];
    const reader = basicReader(templates);
    const trace = emptyTrace();
    const mutation = writer(templates, trace);

    await questions.ensureQuestion({
      submissionId: 'catold',
      subreddit: 'catgirlcoin',
      title: 'How can I bridge NYA to Base?',
      summary: 'Earlier CatgirlCoin bridge question.',
      author: 'Bob',
      permalink: '/r/catgirlcoin/comments/catold/how_can_i_bridge_nya_to_base/',
      createdAt: 100,
    }, true);

    await plans.plan({
      fullname: 't3_nyanew',
      submissionId: 'nyanew',
      subreddit: 'nyaonearth',
      author: 'Alice',
      permalink: '/r/nyaonearth/comments/nyanew/bridge_help/',
      targetFlairTemplateId: 'question',
      targetFlairText: 'Question :hana:',
      isQuestion: true,
      questionTitle: 'How do I bridge NYA from Ethereum to Base?',
      questionSummary: 'The OP wants to move NYA from Ethereum to Base.',
      createdAt: 200,
    });

    const reputation: PostOrganisationReputation = { hasContribution: async () => true };
    const runtime = new PostOrganisationRuntime(
      plans,
      reputation,
      reader,
      mutation,
      questions,
      events,
      repeats,
    );

    const result = await runtime.tick();
    expect(result).toMatchObject({ organised: 1, questions: 0, duplicates: 1, failed: 0 });
    expect(trace.createdFlairs).toEqual([REPEATED_QUESTION_FLAIR_TEXT]);
    expect(trace.flairs).toEqual([['nyaonearth', 'nyanew', 'repeat-flair']]);
    expect(trace.replies).toHaveLength(1);
    expect(trace.replies[0]?.[0]).toBe('t3_nyanew');
    expect(trace.replies[0]?.[1]).toContain('r/catgirlcoin');
    expect(trace.replies[0]?.[1]).toContain('`!false`');
    expect(trace.locks).toEqual(['t3_nyanew']);
    expect(trace.messages).toHaveLength(1);
    expect(trace.messages[0]?.[0]).toBe('Alice');
    expect(trace.messages[0]?.[2]).toContain('r/catgirlcoin');

    const review = await repeats.question('nyanew');
    expect(review).toMatchObject({
      status: 'pending',
      matchedSubmissionId: 'catold',
      matchedSubreddit: 'catgirlcoin',
      duplicateCommentId: 'mae1',
      flairApplied: true,
      locked: true,
      pmSent: true,
      reviewEventSent: true,
    });
    expect(review?.similarity ?? 0).toBeGreaterThan(0.49);

    const page = await events.after(0);
    expect(page.events).toHaveLength(1);
    expect(page.events[0]).toMatchObject({
      kind: 'repeat_review_requested',
      submissionId: 'nyanew',
      subreddit: 'nyaonearth',
      matchedSubmissionId: 'catold',
      matchedSubreddit: 'catgirlcoin',
    });
    expect(await questions.question('nyanew')).toBeNull();
  });

  test('unique questions get the canonical acknowledgement and event while ordinary posts only get organised', async () => {
    const dir = await temp();
    const plans = new PostOrganisationStore(join(dir, 'plans.pb'));
    const questions = new QuestionStateStore(join(dir, 'questions.pb'));
    const events = new QuestionEventStore(join(dir, 'events.pb'));
    const repeats = new RepeatedQuestionStore(join(dir, 'repeats.pb'));
    const templates = [
      flair('question', 'Question :hana:'),
      flair('news', 'News'),
      flair('repeat', REPEATED_QUESTION_FLAIR_TEXT, true),
    ];
    const reader = basicReader(templates);
    const trace = emptyTrace();
    const mutation = writer(templates, trace);

    await plans.plan({
      fullname: 't3_unique1',
      submissionId: 'unique1',
      subreddit: 'nyaonearth',
      author: 'Alice',
      permalink: '/r/nyaonearth/comments/unique1/where_contract/',
      targetFlairTemplateId: 'question',
      targetFlairText: 'Question :hana:',
      isQuestion: true,
      questionTitle: 'Where can I find the official NYA contract address on Avalanche?',
      questionSummary: 'The OP wants to verify the official Avalanche contract before adding the token to a wallet.',
      createdAt: 300,
    });
    await plans.plan({
      fullname: 't3_news1',
      submissionId: 'news1',
      subreddit: 'catgirlcoin',
      author: 'Carol',
      permalink: '/r/catgirlcoin/comments/news1/project_update/',
      targetFlairTemplateId: 'news',
      targetFlairText: 'News',
      isQuestion: false,
      questionTitle: '',
      questionSummary: '',
      createdAt: 301,
    });

    const reputation: PostOrganisationReputation = { hasContribution: async () => true };
    const runtime = new PostOrganisationRuntime(
      plans,
      reputation,
      reader,
      mutation,
      questions,
      events,
      repeats,
    );

    const result = await runtime.tick();
    expect(result).toMatchObject({ organised: 2, questions: 1, duplicates: 0, failed: 0 });
    expect(trace.flairs).toEqual([
      ['nyaonearth', 'unique1', 'question'],
      ['catgirlcoin', 'news1', 'news'],
    ]);
    expect(trace.replies).toHaveLength(1);
    expect(trace.replies[0]?.[0]).toBe('t3_unique1');
    expect(trace.replies[0]?.[1]).toContain('Please be patient');
    expect(trace.distinguished).toEqual([['t1_mae1', true]]);

    const page = await events.after(0);
    expect(page.events).toHaveLength(1);
    expect(page.events[0]).toMatchObject({
      kind: 'question_opened',
      submissionId: 'unique1',
      subreddit: 'nyaonearth',
      title: 'Where can I find the official NYA contract address on Avalanche?',
      summary: 'The OP wants to verify the official Avalanche contract before adding the token to a wallet.',
    });
    expect((await questions.question('unique1'))?.acknowledgementCommentId).toBe('mae1');
    expect(await questions.question('news1')).toBeNull();
  });

  test('organisation is deferred until moderation has persisted the canonical contribution', async () => {
    const dir = await temp();
    const plans = new PostOrganisationStore(join(dir, 'plans.pb'));
    const questions = new QuestionStateStore(join(dir, 'questions.pb'));
    const events = new QuestionEventStore(join(dir, 'events.pb'));
    const repeats = new RepeatedQuestionStore(join(dir, 'repeats.pb'));
    const templates = [flair('discussion', 'Discussion')];
    const reader = basicReader(templates);
    const trace = emptyTrace();
    const mutation = writer(templates, trace);

    await plans.plan({
      fullname: 't3_wait1',
      submissionId: 'wait1',
      subreddit: 'nyaonearth',
      author: 'Alice',
      permalink: '/r/nyaonearth/comments/wait1/wait/',
      targetFlairTemplateId: 'discussion',
      targetFlairText: 'Discussion',
      isQuestion: false,
      questionTitle: '',
      questionSummary: '',
      createdAt: 400,
    });

    let persisted = false;
    const reputation: PostOrganisationReputation = { hasContribution: async () => persisted };
    const runtime = new PostOrganisationRuntime(
      plans,
      reputation,
      reader,
      mutation,
      questions,
      events,
      repeats,
    );

    expect(await runtime.tick()).toMatchObject({ deferred: 1, organised: 0 });
    expect(trace.flairs).toHaveLength(0);
    persisted = true;
    expect(await runtime.tick()).toMatchObject({ deferred: 0, organised: 1, failed: 0 });
    expect(trace.flairs).toHaveLength(1);
  });
});
