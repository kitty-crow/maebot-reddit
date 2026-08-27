import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QuestionEventStore } from '../src/questions/events.ts';
import { RepeatedQuestionStore } from '../src/questions/repeats.ts';
import {
  RedditQuestionRuntime,
  type QuestionRuntimeReader,
  type QuestionRuntimeWriter,
} from '../src/questions/runtime.ts';
import { QuestionStateStore } from '../src/questions/state.ts';
import type { RedditComment } from '../src/reddit/types.ts';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(async dir => await rm(dir, { recursive: true, force: true })));
});

const temp = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'maebot-reddit-question-runtime-'));
  dirs.push(dir);
  return dir;
};

const commandComment = (
  id: string,
  submissionId: string,
  parentId: string,
  author: string,
  body: string,
  createdUtc: number,
  subreddit = 'catgirlcoin',
): RedditComment => ({
  id,
  fullname: `t1_${id}`,
  subreddit,
  submissionFullname: `t3_${submissionId}`,
  parentFullname: `t1_${parentId}`,
  submissionTitle: 'Messy human title',
  submissionAuthor: 'Alice',
  submissionPermalink: `/r/${subreddit}/comments/${submissionId}/question/`,
  submissionFlairText: 'Question :hana:',
  author,
  body,
  permalink: `/r/${subreddit}/comments/${submissionId}/question/${id}/`,
  createdUtc,
  distinguished: null,
  stickied: false,
  removedByCategory: null,
  score: 1,
  mediaUrls: [],
});

const thankyou = (
  id: string,
  submissionId: string,
  parentId: string,
  author: string,
  createdUtc: number,
  subreddit = 'catgirlcoin',
): RedditComment => commandComment(
  id,
  submissionId,
  parentId,
  author,
  '!thankyou',
  createdUtc,
  subreddit,
);

describe('Reddit question runtime', () => {
  test('only canonical questions accept !thankyou and OP/mod authority still resolves them', async () => {
    const dir = await temp();
    const events = new QuestionEventStore(join(dir, 'events.pb'));
    const state = new QuestionStateStore(join(dir, 'state.pb'));

    const historicCommand = thankyou('oldthank', 'old1', 'oldanswer', 'Alice', 110);
    let comments: readonly RedditComment[] = [historicCommand];
    let moderatorReads = 0;
    const reader: QuestionRuntimeReader = {
      newComments: async () => comments,
      moderators: async () => {
        moderatorReads += 1;
        return [{ name: 'KittyMod', id: 'm1', permissions: ['all'] }];
      },
    };
    const runtime = new RedditQuestionRuntime(['catgirlcoin'], reader, state, events, 60_000);

    expect(await runtime.tick()).toEqual({
      activated: 1,
      seeded: 0,
      opened: 0,
      resolved: 0,
      repeatOverrides: 0,
      ignored: 0,
      failed: 0,
    });
    expect(await state.commandHandled(historicCommand.id)).toBe(true);
    expect((await events.after(0)).events).toEqual([]);

    await state.ensureQuestion({
      submissionId: 'fresh1',
      subreddit: 'catgirlcoin',
      title: 'How can I bridge NYA to Base?',
      summary: 'The OP has NYA on Ethereum and wants the supported route to Base.',
      author: 'Alice',
      permalink: '/r/catgirlcoin/comments/fresh1/question/',
      createdAt: 200,
    }, true);

    const byOp = thankyou('thanks1', 'fresh1', 'answer1', 'alice', 210);
    comments = [byOp, historicCommand];
    const opResult = await runtime.tick();
    expect(opResult.resolved).toBe(1);
    expect(moderatorReads).toBe(0);

    const afterOp = (await events.after(0)).events;
    expect(afterOp).toHaveLength(1);
    expect(afterOp[0]).toMatchObject({
      kind: 'best_answer_selected',
      submissionId: 'fresh1',
      title: 'How can I bridge NYA to Base?',
      summary: 'The OP has NYA on Ethereum and wants the supported route to Base.',
      selectionCommentId: 'thanks1',
      answerCommentId: 'answer1',
      answerAuthor: null,
      answerPermalink: '/r/catgirlcoin/comments/fresh1/question/answer1/',
    });
    expect((await state.question('fresh1'))?.bestAnswerCommentId).toBe('answer1');

    const denied = thankyou('thanks2', 'fresh1', 'answer2', 'Mallory', 220);
    comments = [denied, byOp];
    const deniedResult = await runtime.tick();
    expect(deniedResult.ignored).toBe(1);
    expect(moderatorReads).toBe(1);
    expect((await events.after(0)).events).toHaveLength(1);
    expect(await state.commandHandled('thanks2')).toBe(true);

    const byMod = thankyou('thanks3', 'fresh1', 'answer3', 'kittymod', 230);
    comments = [byMod, denied, byOp];
    const modResult = await runtime.tick();
    expect(modResult.resolved).toBe(1);
    expect(moderatorReads).toBe(1);
    const final = (await events.after(0)).events;
    expect(final).toHaveLength(2);
    expect(final[1]).toMatchObject({ selectionCommentId: 'thanks3', answerCommentId: 'answer3' });
    expect((await state.question('fresh1'))?.bestAnswerCommentId).toBe('answer3');

    const unknown = thankyou('thanks4', 'notcanonical', 'answer4', 'Alice', 240);
    comments = [unknown, byMod];
    const unknownResult = await runtime.tick();
    expect(unknownResult.ignored).toBe(1);
    expect(await state.question('notcanonical')).toBeNull();
    expect((await events.after(0)).events).toHaveLength(2);
  });

  test('only a subreddit moderator replying !false directly to Mae restores a repeated question', async () => {
    const dir = await temp();
    const events = new QuestionEventStore(join(dir, 'events.pb'));
    const state = new QuestionStateStore(join(dir, 'state.pb'));
    const repeats = new RepeatedQuestionStore(join(dir, 'repeats.pb'));

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
      distinguish: async (fullname, sticky) => {
        distinguished.push([fullname, sticky]);
      },
    };

    let comments: readonly RedditComment[] = [];
    let moderatorReads = 0;
    const reader: QuestionRuntimeReader = {
      newComments: async () => comments,
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

    const userAttempt = commandComment('false-user', 'repeat1', 'maewarn', 'Alice', '!false', 201, 'nyaonearth');
    comments = [userAttempt];
    expect((await runtime.tick()).ignored).toBe(1);
    expect((await repeats.question('repeat1'))?.status).toBe('pending');
    expect(flairs).toHaveLength(0);

    const wrongParent = commandComment('false-wrong', 'repeat1', 'someoneelse', 'KittyMod', '!false', 202, 'nyaonearth');
    comments = [wrongParent, userAttempt];
    expect((await runtime.tick()).ignored).toBe(1);
    expect((await repeats.question('repeat1'))?.status).toBe('pending');
    expect(flairs).toHaveLength(0);

    const valid = commandComment('false-valid', 'repeat1', 'maewarn', 'kittymod', '  !FALSE  ', 203, 'nyaonearth');
    comments = [valid, wrongParent, userAttempt];
    const result = await runtime.tick();
    expect(result.repeatOverrides).toBe(1);
    expect(result.failed).toBe(0);

    expect(flairs).toEqual([['nyaonearth', 'repeat1', 'question-flair']]);
    expect(unlocked).toEqual(['t3_repeat1']);
    expect(deleted).toEqual(['t1_maewarn']);
    expect(messages).toEqual([[
      'Alice',
      'Mae repeat review',
      'Apologies, after reviewing, our Moderators found the question was indeed not a repeat!',
    ]]);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.[0]).toBe('t3_repeat1');
    expect(replies[0]?.[1]).toContain('Please be patient');
    expect(distinguished).toEqual([['t1_ack1', true]]);

    const repeat = await repeats.question('repeat1');
    expect(repeat).toMatchObject({
      status: 'overturned',
      falseCommandId: 'false-valid',
      reviewedBy: 'kittymod',
      reviewedAt: 203,
      questionFlairRestored: true,
      unlocked: true,
      duplicateCommentDeleted: true,
      apologySent: true,
      questionOpened: true,
    });
    expect(await repeats.bypassed('repeat1')).toBe(true);

    const question = await state.question('repeat1');
    expect(question).toMatchObject({
      submissionId: 'repeat1',
      title: 'How can I bridge NYA to Base?',
      acknowledgementCommentId: 'ack1',
      openedHandled: true,
    });

    const page = await events.after(0);
    expect(page.events).toHaveLength(1);
    expect(page.events[0]).toMatchObject({
      kind: 'question_opened',
      submissionId: 'repeat1',
      subreddit: 'nyaonearth',
      title: 'How can I bridge NYA to Base?',
      at: 203,
    });

    const before = {
      flairs: flairs.length,
      unlocked: unlocked.length,
      deleted: deleted.length,
      messages: messages.length,
      replies: replies.length,
      events: page.events.length,
    };
    comments = [valid];
    const again = await runtime.tick();
    expect(again.repeatOverrides).toBe(0);
    expect(flairs).toHaveLength(before.flairs);
    expect(unlocked).toHaveLength(before.unlocked);
    expect(deleted).toHaveLength(before.deleted);
    expect(messages).toHaveLength(before.messages);
    expect(replies).toHaveLength(before.replies);
    expect((await events.after(0)).events).toHaveLength(before.events);
    expect(moderatorReads).toBe(1);
  });
});
