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
      subreddit: 'nyaonearth',
      flairTemplateId: 'question',
      isQuestion: true,
      questionTitle: 'How can I bridge NYA from Ethereum to Base?',
    }]);

    response = {
      verdict: 'severe',
      rule: 'rule_6',
      disposition: 'remove',
      penaltyPoints: 10,
      confidence: 0.99,
      reason: 'Removed.',
      evidence: ['scam-like claim'],
      postOrganisation: null,
    };
    await classifier.classify(post({ permalink: '/r/nyaonearth/comments/removed123/bad/' }));
    expect(await plans.pending()).toHaveLength(1);
  });

  test('emits cleaned canonical question fields and matches duplicates across both communities', async () => {
    const dir = await temp();
    const plans = new PostOrganisationStore(join(dir, 'plans.pb'));
    const state = new QuestionStateStore(join(dir, 'questions.pb'));
    const events = new QuestionEventStore(join(dir, 'events.pb'));

    await state.ensureQuestion({
      submissionId: 'cat-old',
      subreddit: 'catgirlcoin',
      title: 'How can I bridge NYA from Ethereum to Base?',
      author: 'Bob',
      permalink: '/r/catgirlcoin/comments/cat-old/how_can_i_bridge_nya/',
      createdAt: 1,
    }, true);

    const replies: Array<{ subreddit: string; id: string; text: string }> = [];
    const flairWrites: Array<{ subreddit: string; id: string; flair: string }> = [];
    const writer: PostOrganisationWriter = {
      setPostFlair: async (subreddit, id, flairTemplateId) => {
        flairWrites.push({ subreddit, id, flair: flairTemplateId });
      },
      replyToPost: async (subreddit, id, text) => {
        replies.push({ subreddit, id, text });
      },
    };
    const reputation: PostOrganisationReputation = {
      contribution: async () => ({ exists: true }),
    };
    const runtime = new PostOrganisationRuntime(plans, writer, reputation, state, events);

    await plans.enqueue({
      submissionId: 'nya-new',
      subreddit: 'nyaonearth',
      author: 'Alice',
      permalink: '/r/nyaonearth/comments/nya-new/help/',
      createdAt: 2,
      flairTemplateId: 'question',
      isQuestion: true,
      questionTitle: 'How do I bridge NYA from Ethereum onto Base?',
      questionSummary: 'The OP wants the supported Ethereum-to-Base route.',
    });

    const first = await runtime.tick();
    expect(first.duplicates).toBe(1);
    expect(first.opened).toBe(0);
    expect(flairWrites).toEqual([{ subreddit: 'nyaonearth', id: 'nya-new', flair: 'question' }]);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.text).toContain('/r/catgirlcoin/comments/cat-old/how_can_i_bridge_nya/');
    expect(await state.question('nya-new')).toBeNull();
    expect((await events.page(0)).events).toHaveLength(0);

    await plans.enqueue({
      submissionId: 'nya-unique',
      subreddit: 'nyaonearth',
      author: 'Carol',
      permalink: '/r/nyaonearth/comments/nya-unique/help/',
      createdAt: 3,
      flairTemplateId: 'question',
      isQuestion: true,
      questionTitle: 'Why does my staking balance take time to refresh?',
      questionSummary: 'The OP sees a delay between staking and the displayed balance.',
    });

    const second = await runtime.tick();
    expect(second.opened).toBe(1);
    const page = await events.page(0);
    expect(page.events).toMatchObject([{
      kind: 'question_opened',
      submissionId: 'nya-unique',
      title: 'Why does my staking balance take time to refresh?',
      summary: 'The OP sees a delay between staking and the displayed balance.',
    }]);
  });
});
