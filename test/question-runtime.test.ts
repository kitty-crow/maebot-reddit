import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QuestionEventStore } from '../src/questions/events.ts';
import { RedditQuestionRuntime, type QuestionRuntimeReader } from '../src/questions/runtime.ts';
import { QuestionStateStore } from '../src/questions/state.ts';
import type { RedditComment } from '../src/reddit/types.ts';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(async dir => await rm(dir, { recursive: true, force: true })));
});

const thankyou = (
  id: string,
  submissionId: string,
  parentId: string,
  author: string,
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
  body: '!thankyou',
  permalink: `/r/${subreddit}/comments/${submissionId}/question/${id}/`,
  createdUtc,
  distinguished: null,
  stickied: false,
  removedByCategory: null,
  score: 1,
  mediaUrls: [],
});

describe('Reddit question runtime', () => {
  test('only canonical questions accept !thankyou and OP/mod authority still resolves them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'maebot-reddit-question-runtime-'));
    dirs.push(dir);
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

    // Flair alone is not authority. This submission was never accepted by the
    // moderation/organisation pipeline, so !thankyou cannot manufacture state.
    const unknown = thankyou('thanks4', 'notcanonical', 'answer4', 'Alice', 240);
    comments = [unknown, byMod];
    const unknownResult = await runtime.tick();
    expect(unknownResult.ignored).toBe(1);
    expect(await state.question('notcanonical')).toBeNull();
    expect((await events.after(0)).events).toHaveLength(2);
  });
});
