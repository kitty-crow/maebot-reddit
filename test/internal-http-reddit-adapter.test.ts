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
  const root = await mkdtemp(join(tmpdir(), 'mae-reddit-adapter-api-'));
  roots.push(root);
  const server = new RedditInternalHttpServer(
    { host: '127.0.0.1', port: 0, token: 'test-secret' },
    new QuestionEventStore(join(root, 'questions.pb')),
    new ModerationReviewStore(join(root, 'reviews.pb')),
    () => undefined,
  );
  servers.push(server);
  return server;
};

describe('Reddit adapter on the existing internal listener', () => {
  test('uses the existing bearer boundary and no second server', async () => {
    const server = await fixture();
    const seen: unknown[] = [];
    server.useRedditAdapter(async request => {
      seen.push(request);
      return {
        supported: true,
        status: 200,
        body: { id: 'mae', name: 'this_is_the_mae' },
      };
    });
    server.start();

    const response = await fetch(`${server.address()}/v1/reddit-adapter`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ method: 'GET', path: '/api/v1/me' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      supported: true,
      status: 200,
      body: { id: 'mae', name: 'this_is_the_mae' },
    });
    expect(seen).toEqual([{ method: 'GET', path: '/api/v1/me' }]);
  });

  test('rejects unauthorised adapter calls', async () => {
    const server = await fixture();
    server.useRedditAdapter(async () => ({ supported: false }));
    server.start();

    const response = await fetch(`${server.address()}/v1/reddit-adapter`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'GET', path: '/api/v1/me' }),
    });
    expect(response.status).toBe(401);
  });

  test('is unavailable unless an adapter backend was explicitly attached', async () => {
    const server = await fixture();
    server.start();

    const response = await fetch(`${server.address()}/v1/reddit-adapter`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ method: 'GET', path: '/api/v1/me' }),
    });
    expect(response.status).toBe(503);
  });
});
