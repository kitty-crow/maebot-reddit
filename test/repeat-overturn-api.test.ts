import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RedditInternalHttpServer } from '../src/http/server.ts';
import { ModerationReviewStore } from '../src/mod/review.ts';
import { QuestionEventStore } from '../src/questions/events.ts';
import { RepeatedQuestionStore } from '../src/questions/repeats.ts';
import {
  RedditQuestionRuntime,
  type QuestionRuntimeReader,
  type QuestionRuntimeWriter,
} from '../src/questions/runtime.ts';
import { QuestionStateStore } from '../src/questions/state.ts';

const roots: string[] = [];
const servers: RedditInternalHttpServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) server.stop();
  await Promise.all(roots.splice(0).map(async root => await rm(root, { recursive: true, force: true })));
});

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'maebot-reddit-repeat-overturn-'));
  roots.push(root);

  const events = new QuestionEventStore(join(root, 'events.pb'));
  const state = new QuestionStateStore(join(root, 'state.pb'));
  const repeats = new RepeatedQuestionStore(join(root, 'repeats.pb'));
  const reviews = new ModerationReviewStore(join(root, 'reviews.pb'));

  await state.bootstrap('nyaonearth', [], []);
  await repeats.ensure({
    submissionId: 'repeat1',
    subreddit: 'nyaonearth',
    author: 'Alice',
    permalink: '/r/nyaonearth/comments/repeat1/question/',
    title: 'How can I bridge NYA to Base?',
    summary: 'The OP wants the supported NYA bridge route.',
    questionFlairTemplateId: 'question-flair',
    questionFlairText: 'Question :hana:',
    repeatedFlairTemplateId: 'repeat-flair',
    matchedSubmissionId: 'old1',
    matchedSubreddit: 'catgirlcoin',
    matchedTitle: 'How do I bridge NYA?',
    matchedPermalink: '/r/catgirlcoin/comments/old1/question/',
    similarity: 0.72,
    createdAt: 100,
  });
  await repeats.setDuplicateComment(
    'repeat1',
    'maewarn',
    '/r/nyaonearth/comments/repeat1/question/maewarn/',
  );
  await repeats.markFlairApplied('repeat1');
  await repeats.markLocked('repeat1');
  await repeats.markPmSent('repeat1');
  await repeats.markReviewEventSent('repeat1');

  const flairs: Array<readonly [string, string, string]> = [];
  const unlocked: string[] = [];
  const deleted: string[] = [];
  const messages: Array<readonly [string, string, string]> = [];
  const replies: Array<readonly [string, string]> = [];
  const distinguished: Array<readonly [string, boolean]> = [];

  const writer: QuestionRuntimeWriter = {
    setPostFlairTemplate: async (subreddit, submissionId, templateId) => {
      flairs.push([subreddit, submissionId, templateId]);
    },
    unlock: async fullname => {
      unlocked.push(fullname);
    },
    deleteContent: async fullname => {
      deleted.push(fullname);
    },
    sendPrivateMessage: async (username, subject, body) => {
      messages.push([username, subject, body]);
    },
    reply: async (fullname, body) => {
      replies.push([fullname, body]);
      return {
        id: 'ack1',
        fullname: 't1_ack1',
        permalink: '/r/nyaonearth/comments/repeat1/question/ack1/',
      };
    },
    distinguish: async (fullname, sticky = false) => {
      distinguished.push([fullname, sticky]);
    },
  };

  let moderatorReads = 0;
  const reader: QuestionRuntimeReader = {
    newComments: async () => [],
    moderators: async () => {
      moderatorReads += 1;
      return [{ name: 'KittyMod', id: 'm1', permissions: ['all'] }];
    },
  };

  const runtime = new RedditQuestionRuntime(
    ['nyaonearth'],
    reader,
    state,
    events,
    60_000,
    repeats,
    writer,
  );

  const server = new RedditInternalHttpServer(
    { host: '127.0.0.1', port: 0, token: 'test-secret' },
    events,
    reviews,
    () => {},
  );
  server.useQuestions(runtime);
  server.start();
  servers.push(server);

  return {
    base: server.address(),
    events,
    repeats,
    state,
    flairs,
    unlocked,
    deleted,
    messages,
    replies,
    distinguished,
    moderatorReads: (): number => moderatorReads,
  };
};

const headers = {
  authorization: 'Bearer test-secret',
  'content-type': 'application/json',
} as const;

const request = async (
  base: string,
  body: {
    readonly key: string;
    readonly platform: string;
    readonly userId: string;
    readonly userName: string;
    readonly actionId: string;
  },
): Promise<Response> => await fetch(`${base}/v1/questions/repeats/overturn`, {
  method: 'POST',
  headers,
  body: JSON.stringify(body),
});

describe('Discord repeated-question overturn API', () => {
  test('runs the canonical !false restoration once and remains idempotent', async () => {
    const fixtureValue = await fixture();

    const first = await request(fixtureValue.base, {
      key: 'repeat_review_requested:repeat1',
      platform: 'discord',
      userId: '7',
      userName: 'Kitty',
      actionId: 'interaction-1',
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ outcome: 'overturned' });

    expect(fixtureValue.flairs).toEqual([['nyaonearth', 'repeat1', 'question-flair']]);
    expect(fixtureValue.unlocked).toEqual(['t3_repeat1']);
    expect(fixtureValue.deleted).toEqual(['t1_maewarn']);
    expect(fixtureValue.messages).toEqual([[
      'Alice',
      'Mae repeat review',
      'Apologies, after reviewing, our Moderators found the question was indeed not a repeat!',
    ]]);
    expect(fixtureValue.replies).toHaveLength(1);
    expect(fixtureValue.distinguished).toEqual([['t1_ack1', true]]);
    expect(fixtureValue.moderatorReads()).toBe(0);

    expect(await fixtureValue.repeats.question('repeat1')).toMatchObject({
      status: 'overturned',
      falseCommandId: 'interaction-1',
      reviewedBy: 'discord:Kitty:7',
      questionFlairRestored: true,
      unlocked: true,
      duplicateCommentDeleted: true,
      apologySent: true,
      questionOpened: true,
    });
    expect(await fixtureValue.state.question('repeat1')).toMatchObject({
      submissionId: 'repeat1',
      acknowledgementCommentId: 'ack1',
      openedHandled: true,
    });
    expect((await fixtureValue.events.after(0)).events).toHaveLength(1);

    const before = {
      flairs: fixtureValue.flairs.length,
      unlocked: fixtureValue.unlocked.length,
      deleted: fixtureValue.deleted.length,
      messages: fixtureValue.messages.length,
      replies: fixtureValue.replies.length,
      distinguished: fixtureValue.distinguished.length,
      events: (await fixtureValue.events.after(0)).events.length,
    };

    const second = await request(fixtureValue.base, {
      key: 'repeat_review_requested:repeat1',
      platform: 'discord',
      userId: '8',
      userName: 'SecondMod',
      actionId: 'interaction-2',
    });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ outcome: 'already_overturned' });
    expect(fixtureValue.flairs).toHaveLength(before.flairs);
    expect(fixtureValue.unlocked).toHaveLength(before.unlocked);
    expect(fixtureValue.deleted).toHaveLength(before.deleted);
    expect(fixtureValue.messages).toHaveLength(before.messages);
    expect(fixtureValue.replies).toHaveLength(before.replies);
    expect(fixtureValue.distinguished).toHaveLength(before.distinguished);
    expect((await fixtureValue.events.after(0)).events).toHaveLength(before.events);
  });

  test('serialises simultaneous moderator actions so side effects remain first-wins', async () => {
    const fixtureValue = await fixture();

    const [first, second] = await Promise.all([
      request(fixtureValue.base, {
        key: 'repeat_review_requested:repeat1',
        platform: 'discord',
        userId: '7',
        userName: 'Kitty',
        actionId: 'interaction-a',
      }),
      request(fixtureValue.base, {
        key: 'repeat_review_requested:repeat1',
        platform: 'discord',
        userId: '8',
        userName: 'SecondMod',
        actionId: 'interaction-b',
      }),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = await first.json() as { outcome: string };
    const secondBody = await second.json() as { outcome: string };
    expect([firstBody.outcome, secondBody.outcome].sort()).toEqual([
      'already_overturned',
      'overturned',
    ]);

    expect(fixtureValue.flairs).toHaveLength(1);
    expect(fixtureValue.unlocked).toHaveLength(1);
    expect(fixtureValue.deleted).toHaveLength(1);
    expect(fixtureValue.messages).toHaveLength(1);
    expect(fixtureValue.replies).toHaveLength(1);
    expect(fixtureValue.distinguished).toHaveLength(1);
    expect((await fixtureValue.events.after(0)).events).toHaveLength(1);
  });

  test('fails closed for unauthorised, malformed and missing repeat actions', async () => {
    const fixtureValue = await fixture();
    const endpoint = `${fixtureValue.base}/v1/questions/repeats/overturn`;

    const unauthorised = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        key: 'repeat_review_requested:repeat1',
        platform: 'discord',
        userId: '7',
        userName: 'Kitty',
        actionId: 'interaction-1',
      }),
    });
    expect(unauthorised.status).toBe(401);

    const wrongPlatform = await request(fixtureValue.base, {
      key: 'repeat_review_requested:repeat1',
      platform: 'telegram',
      userId: '7',
      userName: 'Kitty',
      actionId: 'interaction-1',
    });
    expect(wrongPlatform.status).toBe(400);

    const malformedKey = await request(fixtureValue.base, {
      key: 'not-a-repeat',
      platform: 'discord',
      userId: '7',
      userName: 'Kitty',
      actionId: 'interaction-1',
    });
    expect(malformedKey.status).toBe(400);

    const missing = await request(fixtureValue.base, {
      key: 'repeat_review_requested:missing1',
      platform: 'discord',
      userId: '7',
      userName: 'Kitty',
      actionId: 'interaction-1',
    });
    expect(missing.status).toBe(404);
  });
});
