import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QuestionEventStore } from '../src/questions/events.ts';

const dirs: string[] = [];

const questionStore = async (): Promise<QuestionEventStore> => {
  const dir = await mkdtemp(join(tmpdir(), 'maebot-reddit-question-events-'));
  dirs.push(dir);
  return new QuestionEventStore(join(dir, 'questionEvents.pb'));
};

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(async dir => await rm(dir, { recursive: true, force: true })));
});

describe('Reddit question event store', () => {
  test('opened and best-answer events are deterministic, idempotent and cursor ordered', async () => {
    const store = await questionStore();
    const opened = await store.opened({
      submissionId: 'abc123',
      title: 'How does NYA work?',
      submissionAuthor: 'alice',
      submissionPermalink: '/r/catgirlcoin/comments/abc123/question/',
      at: 100,
    });
    const duplicate = await store.opened({
      submissionId: 'abc123',
      title: 'A later duplicate must not replace the first event',
      submissionAuthor: 'mallory',
      submissionPermalink: '/different',
      at: 999,
    });
    expect(duplicate).toEqual(opened);
    expect(opened.sequence).toBe(1);
    expect(opened.key).toBe('question_opened:abc123');
    expect(opened.answerCommentId).toBeNull();

    const best = await store.bestAnswer({
      submissionId: 'abc123',
      title: 'How does NYA work?',
      submissionAuthor: 'alice',
      submissionPermalink: '/r/catgirlcoin/comments/abc123/question/',
      answerCommentId: 'def456',
      answerAuthor: 'bob',
      answerPermalink: '/r/catgirlcoin/comments/abc123/question/def456/',
      at: 200,
    });
    expect(best.sequence).toBe(2);
    expect(best.key).toBe('best_answer_selected:abc123:def456');
    expect(best.answerCommentId).toBe('def456');

    const firstPage = await store.after(0, 1);
    expect(firstPage.events).toEqual([opened]);
    expect(firstPage.next).toBe(1);

    const secondPage = await store.after(firstPage.next, 100);
    expect(secondPage.events).toEqual([best]);
    expect(secondPage.next).toBe(2);

    const empty = await store.after(secondPage.next, 100);
    expect(empty.events).toEqual([]);
    expect(empty.next).toBe(2);
  });
});
