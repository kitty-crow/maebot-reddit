import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RedditModerationCfg } from '../src/env.ts';
import type {
  ModerationClassification,
  ModerationClassifier,
  ModerationItem,
} from '../src/mod/classifier.ts';
import {
  OrganisingModerationClassifier,
  PostOrganisationRuntime,
  PostOrganisationStore,
  type PostOrganisationReader,
  type PostOrganisationReputation,
  type PostOrganisationWriter,
} from '../src/questions/organisation.ts';
import { QuestionEventStore } from '../src/questions/events.ts';
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

const clean = (organisation: ModerationClassification['postOrganisation']): ModerationClassification => ({
  verdict: 'clean',
  rule: 'none',
  disposition: 'allow',
  penaltyPoints: 0,
  confidence: 0.99,
  reason: 'Allowed.',
  evidence: [],
  postOrganisation: organisation,
});

describe('moderation-owned Reddit post organisation', () => {
  test('uses one classification call, exposes live flairs, and never plans removed posts', async () => {
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

  test('cosine duplicate detection is shared across both communities and links to the earlier community', async () => {
    const dir = await temp();
    const plans = new PostOrganisationStore(join(dir, 'plans.pb'));
    const questions = new QuestionStateStore(join(dir, 'questions.pb'));
    const events = new QuestionEventStore(join(dir, 'events.pb'));

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

    const flairs: Array<readonly [string, string, string]> = [];
    const messages: Array<readonly [string, string, string]> = [];
    const writer: PostOrganisationWriter = {
      setPostFlairTemplate: async (subreddit, submissionId, templateId) => {
        flairs.push([subreddit, submissionId, templateId]);
      },
      sendPrivateMessage: async (username, subject, body) => {
        messages.push([username, subject, body]);
      },
    };
    const reputation: PostOrganisationReputation = { hasContribution: async () => true };
    const runtime = new PostOrganisationRuntime(plans, reputation, writer, questions, events);

    const result = await runtime.tick();
    expect(result).toMatchObject({ organised: 1, questions: 0, duplicates: 1, failed: 0 });
    expect(flairs).toEqual([['nyaonearth', 'nyanew', 'question']]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.[0]).toBe('Alice');
    expect(messages[0]?.[2]).toContain('r/catgirlcoin');
    expect(messages[0]?.[2]).toContain('https://reddit.com/r/catgirlcoin/comments/catold/how_can_i_bridge_nya_to_base/');
    expect((await events.after(0)).events).toEqual([]);
    expect(await questions.question('nyanew')).toBeNull();
  });

  test('unique questions emit canonical title and concise summary while ordinary posts only get organised', async () => {
    const dir = await temp();
    const plans = new PostOrganisationStore(join(dir, 'plans.pb'));
    const questions = new QuestionStateStore(join(dir, 'questions.pb'));
    const events = new QuestionEventStore(join(dir, 'events.pb'));

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

    const flairs: Array<readonly [string, string, string]> = [];
    const writer: PostOrganisationWriter = {
      setPostFlairTemplate: async (subreddit, submissionId, templateId) => {
        flairs.push([subreddit, submissionId, templateId]);
      },
      sendPrivateMessage: async () => undefined,
    };
    const reputation: PostOrganisationReputation = { hasContribution: async () => true };
    const runtime = new PostOrganisationRuntime(plans, reputation, writer, questions, events);

    const result = await runtime.tick();
    expect(result).toMatchObject({ organised: 2, questions: 1, duplicates: 0, failed: 0 });
    expect(flairs).toEqual([
      ['nyaonearth', 'unique1', 'question'],
      ['catgirlcoin', 'news1', 'news'],
    ]);

    const page = await events.after(0);
    expect(page.events).toHaveLength(1);
    expect(page.events[0]).toMatchObject({
      kind: 'question_opened',
      submissionId: 'unique1',
      subreddit: 'nyaonearth',
      title: 'Where can I find the official NYA contract address on Avalanche?',
      summary: 'The OP wants to verify the official Avalanche contract before adding the token to a wallet.',
    });
    expect((await questions.question('unique1'))?.summary).toBe(
      'The OP wants to verify the official Avalanche contract before adding the token to a wallet.',
    );
    expect(await questions.question('news1')).toBeNull();
  });

  test('organisation is deferred until moderation has persisted the canonical contribution', async () => {
    const dir = await temp();
    const plans = new PostOrganisationStore(join(dir, 'plans.pb'));
    const questions = new QuestionStateStore(join(dir, 'questions.pb'));
    const events = new QuestionEventStore(join(dir, 'events.pb'));
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
    let writes = 0;
    const writer: PostOrganisationWriter = {
      setPostFlairTemplate: async () => { writes += 1; },
      sendPrivateMessage: async () => undefined,
    };
    const runtime = new PostOrganisationRuntime(plans, reputation, writer, questions, events);

    expect(await runtime.tick()).toMatchObject({ deferred: 1, organised: 0 });
    expect(writes).toBe(0);
    persisted = true;
    expect(await runtime.tick()).toMatchObject({ deferred: 0, organised: 1, failed: 0 });
    expect(writes).toBe(1);
  });
});
