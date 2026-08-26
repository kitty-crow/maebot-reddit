import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QuestionEventStore } from '../src/questions/events.ts';
import { RedditQuestionRuntime, type QuestionRuntimeReader } from '../src/questions/runtime.ts';
import { QuestionStateStore } from '../src/questions/state.ts';
import type { RedditComment, RedditPost } from '../src/reddit/types.ts';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(async dir => await rm(dir, { recursive: true, force: true })));
});

const post = (id: string, createdUtc: number, overrides: Partial<RedditPost> = {}): RedditPost => ({
  id,
  fullname: `t3_${id}`,
  subreddit: 'catgirlcoin',
  title: `Question ${id}?`,
  author: 'Alice',
  permalink: `/r/catgirlcoin/comments/${id}/question_${id}/`,
  createdUtc,
  selfText: '',
  url: `https://reddit.com/r/catgirlcoin/comments/${id}/question_${id}/`,
  flairTemplateId: 'question-template',
  flairText: 'Question',
  stickied: false,
  locked: false,
  over18: false,
  crosspostParent: null,
  score: 1,
  mediaUrls: [],
  ...overrides,
});

const thankyou = (
  id: string,
  submission: RedditPost,
  parentId: string,
  author: string,
  createdUtc: number,
): RedditComment => ({
  id,
  fullname: `t1_${id}`,
  subreddit: submission.subreddit,
  submissionFullname: submission.fullname,
  parentFullname: `t1_${parentId}`,
  submissionTitle: submission.title,
  submissionAuthor: submission.author,
  submissionPermalink: submission.permalink,
  submissionFlairText: submission.flairText,
  author,
  body: '!thankyou',
  permalink: `${submission.permalink}${id}/`,
  createdUtc,
  distinguished: null,
  stickied: false,
  removedByCategory: null,
  score: 1,
  mediaUrls: [],
});

describe('Reddit question runtime', () => {
  test('establishes a no-history boundary then emits canonical opened and best-answer events', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'maebot-reddit-question-runtime-'));
    dirs.push(dir);
    const events = new QuestionEventStore(join(dir, 'events.pb'));
    const state = new QuestionStateStore(join(dir, 'state.pb'));

    const old = post('old1', 100);
    const oldCommand = thankyou('oldthank', old, 'oldanswer', 'Alice', 110);
    let posts: readonly RedditPost[] = [old];
    let comments: readonly RedditComment[] = [oldCommand];
    let moderatorReads = 0;
    const reader: QuestionRuntimeReader = {
      newPosts: async () => posts,
      newComments: async () => comments,
      moderators: async () => {
        moderatorReads += 1;
        return [{ name: 'KittyMod', id: 'm1', permissions: ['all'] }];
      },
    };
    const runtime = new RedditQuestionRuntime(['catgirlcoin'], reader, state, events, 60_000);

    expect(await runtime.tick()).toEqual({
      activated: 1,
      seeded: 1,
      opened: 0,
      resolved: 0,
      ignored: 0,
      failed: 0,
    });
    expect((await events.after(0)).events).toEqual([]);
    expect(await state.commandHandled(oldCommand.id)).toBe(true);

    const fresh = post('fresh1', 200);
    const mirror = post('mirror1', 201, { crosspostParent: 't3_origin' });
    posts = [mirror, fresh, old];
    expect((await runtime.tick()).opened).toBe(1);
    const opened = (await events.after(0)).events;
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({
      kind: 'question_opened',
      submissionId: 'fresh1',
      subreddit: 'catgirlcoin',
      submissionAuthor: 'Alice',
    });

    const byOp = thankyou('thanks1', fresh, 'answer1', 'alice', 210);
    comments = [byOp, oldCommand];
    const opResult = await runtime.tick();
    expect(opResult.resolved).toBe(1);
    expect(moderatorReads).toBe(0);

    const afterOp = (await events.after(0)).events;
    expect(afterOp[1]).toMatchObject({
      kind: 'best_answer_selected',
      submissionId: 'fresh1',
      selectionCommentId: 'thanks1',
      answerCommentId: 'answer1',
      answerAuthor: null,
      answerPermalink: '/r/catgirlcoin/comments/fresh1/question_fresh1/answer1/',
    });
    expect((await state.question('fresh1'))?.bestAnswerCommentId).toBe('answer1');

    const denied = thankyou('thanks2', fresh, 'answer2', 'Mallory', 220);
    comments = [denied, byOp, oldCommand];
    const deniedResult = await runtime.tick();
    expect(deniedResult.ignored).toBe(1);
    expect(moderatorReads).toBe(1);
    expect((await events.after(0)).events).toHaveLength(2);
    expect(await state.commandHandled('thanks2')).toBe(true);

    const byMod = thankyou('thanks3', fresh, 'answer3', 'kittymod', 230);
    comments = [byMod, denied, byOp];
    const modResult = await runtime.tick();
    expect(modResult.resolved).toBe(1);
    expect(moderatorReads).toBe(1);
    const final = (await events.after(0)).events;
    expect(final).toHaveLength(3);
    expect(final[2]).toMatchObject({ selectionCommentId: 'thanks3', answerCommentId: 'answer3' });
    expect((await state.question('fresh1'))?.bestAnswerCommentId).toBe('answer3');
  });
});
