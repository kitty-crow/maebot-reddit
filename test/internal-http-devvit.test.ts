import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RedditInternalHttpServer } from '../src/http/server.ts';
import { ModerationReviewStore } from '../src/mod/review.ts';
import { QuestionEventStore } from '../src/questions/events.ts';
import { DevvitRpcSpool } from '../src/reddit/devvitRpc.ts';

const roots: string[] = [];
const servers: RedditInternalHttpServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) server.stop();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

test('Devvit bridge shares the Reddit internal listener without sharing auth', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mae-reddit-devvit-http-'));
  roots.push(root);

  const spool = new DevvitRpcSpool(join(root, 'devvitRpc.pb'));
  const server = new RedditInternalHttpServer(
    { host: '127.0.0.1', port: 0, token: 'internal-secret' },
    new QuestionEventStore(join(root, 'questions.pb')),
    new ModerationReviewStore(join(root, 'reviews.pb')),
  );
  server.useDevvitBridge(spool, 'bridge-secret');
  server.start();
  servers.push(server);

  const id = await spool.enqueue('reddit', [{ kind: 'call', name: 'getAppUser', args: [] }]);
  const base = server.address();

  const internalOnBridge = await fetch(`${base}/v1/devvit/work`, {
    headers: { authorization: 'Bearer internal-secret' },
  });
  expect(internalOnBridge.status).toBe(401);

  const bridgeOnInternal = await fetch(`${base}/v1/question-events`, {
    headers: { authorization: 'Bearer bridge-secret' },
  });
  expect(bridgeOnInternal.status).toBe(401);

  const work = await fetch(`${base}/v1/devvit/work`, {
    headers: { authorization: 'Bearer bridge-secret' },
  });
  expect(work.status).toBe(200);
  const workBody = await work.json() as { commands: Array<{ id: string }> };
  expect(workBody.commands.map(command => command.id)).toEqual([id]);

  const complete = await fetch(`${base}/v1/devvit/result`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer bridge-secret',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ id, ok: true, value: { name: 'u/this_is_the_mae' } }),
  });
  expect(complete.status).toBe(200);
  expect(await spool.waitForResult(id, 100)).toEqual({
    id,
    ok: true,
    value: { name: 'u/this_is_the_mae' },
  });
});
