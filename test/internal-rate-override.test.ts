import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RedditInternalHttpServer } from '../src/http/server.ts';
import { ModerationReviewStore } from '../src/mod/review.ts';
import { QuestionEventStore } from '../src/questions/events.ts';

test('only authenticated operators can request a Reddit backlog drain', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reddit-force-drain-'));
  const server = new RedditInternalHttpServer(
    { host: '127.0.0.1', port: 0, token: 'secret' },
    new QuestionEventStore(join(root, 'questions.pb')),
    new ModerationReviewStore(join(root, 'reviews.pb')),
    () => undefined,
  );
  let called = 0;
  server.useRateDrain(async () => {
    called += 1;
    return { ok: true, detail: 'local reserve released; processing queued' };
  });
  server.start();
  try {
    const url = `${server.address()}/v1/rate/force-drain`;
    const denied = await fetch(url, { method: 'POST' });
    expect(denied.status).toBe(401);
    expect(called).toBe(0);

    const accepted = await fetch(url, { method: 'POST', headers: { authorization: 'Bearer secret' } });
    expect(accepted.status).toBe(202);
    expect((await accepted.json() as { ok: boolean }).ok).toBe(true);
    expect(called).toBe(1);
  } finally {
    server.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('a provider cooldown cannot be bypassed through the internal endpoint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reddit-hard-rate-'));
  const server = new RedditInternalHttpServer(
    { host: '127.0.0.1', port: 0, token: 'secret' },
    new QuestionEventStore(join(root, 'questions.pb')),
    new ModerationReviewStore(join(root, 'reviews.pb')),
    () => undefined,
  );
  server.useRateDrain(async () => ({ ok: false, detail: 'Reddit HTTP 429 cooldown' }));
  server.start();
  try {
    const response = await fetch(`${server.address()}/v1/rate/force-drain`, {
      method: 'POST',
      headers: { authorization: 'Bearer secret' },
    });
    expect(response.status).toBe(409);
    expect((await response.json() as { ok: boolean }).ok).toBe(false);
  } finally {
    server.stop();
    await rm(root, { recursive: true, force: true });
  }
});
