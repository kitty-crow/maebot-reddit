import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RedditInternalHttpServer } from '../src/http/server.ts';
import { ModerationReviewStore } from '../src/mod/review.ts';
import { QuestionEventStore } from '../src/questions/events.ts';

const roots: string[] = [];
const servers: RedditInternalHttpServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) server.stop();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'mae-reddit-review-api-'));
  roots.push(root);
  const reviews = new ModerationReviewStore(join(root, 'reviews.pb'));
  const questions = new QuestionEventStore(join(root, 'questions.pb'));
  const server = new RedditInternalHttpServer(
    { host: '127.0.0.1', port: 0, token: 'test-secret' },
    questions,
    reviews,
    () => undefined,
  );
  server.start();
  servers.push(server);
  return { reviews, base: server.address() };
};

const auth = { authorization: 'Bearer test-secret' } as const;

describe('canonical Reddit moderation review API', () => {
  test('returns one authenticated canonical review by key', async () => {
    const { reviews, base } = await fixture();
    const created = await reviews.create({
      key: 'vote-manipulation:t1_example:1',
      targetKind: 'comment',
      targetId: 't1_example',
      subreddit: 'catgirlcoin',
      permalink: '/r/catgirlcoin/comments/example/comment/',
      author: 'alice',
      summary: 'Suspicious vote growth.',
      evidence: ['trajectory evidence only'],
      recommendedAction: 'warn',
      reason: 'Needs human review.',
      policy: 'reddit-vote-manipulation/v1',
      createdAt: 100,
    });

    const response = await fetch(`${base}/v1/moderation/reviews/${encodeURIComponent(created.key)}`, { headers: auth });
    expect(response.status).toBe(200);
    const body = await response.json() as { review: { key: string; decision: null } };
    expect(body.review.key).toBe(created.key);
    expect(body.review.decision).toBeNull();
  });

  test('the same endpoint exposes a first-wins decision made on another platform', async () => {
    const { reviews, base } = await fixture();
    const created = await reviews.create({
      key: 'vote-manipulation:t1_example:2',
      targetKind: 'comment',
      targetId: 't1_example',
      subreddit: 'catgirlcoin',
      permalink: '',
      author: 'alice',
      summary: 'Suspicious vote growth.',
      evidence: [],
      recommendedAction: 'warn',
      reason: 'Needs human review.',
      policy: 'reddit-vote-manipulation/v1',
      createdAt: 100,
    });
    await reviews.decide(created.key, {
      choice: 'reject',
      platform: 'discord',
      userId: '7',
      userName: 'discord-mod',
      at: 110,
    });

    const response = await fetch(`${base}/v1/moderation/reviews/${encodeURIComponent(created.key)}`, { headers: auth });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      review: {
        decision: {
          choice: string;
          platform: string;
          userId: string;
          userName: string;
          at: number;
        } | null;
      };
    };
    expect(body.review.decision).toEqual({
      choice: 'reject',
      platform: 'discord',
      userId: '7',
      userName: 'discord-mod',
      at: 110,
    });
  });

  test('decision writes require moderator identity and unknown cases fail closed', async () => {
    const { reviews, base } = await fixture();
    const created = await reviews.create({
      key: 'vote-manipulation:t1_example:3',
      targetKind: 'comment',
      targetId: 't1_example',
      subreddit: 'catgirlcoin',
      permalink: '',
      author: 'alice',
      summary: 'Suspicious vote growth.',
      evidence: [],
      recommendedAction: 'warn',
      reason: 'Needs human review.',
      policy: 'reddit-vote-manipulation/v1',
      createdAt: 100,
    });
    const endpoint = `${base}/v1/moderation/reviews/decision`;
    const headers = { ...auth, 'content-type': 'application/json' } as const;

    const missingIdentity = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        key: created.key,
        choice: 'approve',
        platform: 'telegram',
        userName: 'telegram-mod',
      }),
    });
    expect(missingIdentity.status).toBe(400);

    const decided = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        key: created.key,
        choice: 'approve',
        platform: 'telegram',
        userId: '42',
        userName: 'telegram-mod',
      }),
    });
    expect(decided.status).toBe(200);
    expect((await reviews.get(created.key))?.decision).toMatchObject({
      choice: 'approve',
      platform: 'telegram',
      userId: '42',
      userName: 'telegram-mod',
    });

    const missingReview = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        key: 'vote-manipulation:t1_missing:1',
        choice: 'reject',
        platform: 'discord',
        userId: '7',
        userName: 'discord-mod',
      }),
    });
    expect(missingReview.status).toBe(404);
  });

  test('requires authentication and returns not found for an unknown valid key', async () => {
    const { base } = await fixture();
    expect((await fetch(`${base}/v1/moderation/reviews/unknown-key`)).status).toBe(401);
    expect((await fetch(`${base}/v1/moderation/reviews/unknown-key`, { headers: auth })).status).toBe(404);
  });

  test('rejects malformed review keys before store lookup', async () => {
    const { base } = await fixture();
    const response = await fetch(`${base}/v1/moderation/reviews/${encodeURIComponent('bad/key')}`, { headers: auth });
    expect(response.status).toBe(400);
  });
});
