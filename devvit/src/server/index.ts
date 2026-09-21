import {
  media,
  reddit,
  redis,
  scheduler,
  settings,
  type TaskRequest,
  type TaskResponse,
} from '@devvit/web/server';
import type { TriggerResponse } from '@devvit/web/shared';
import { Hono } from 'hono';
import { execute, type Command, type Wire } from './controller.ts';

type Work = {
  readonly commands: readonly Command[];
};

type Result = {
  readonly id: string;
  readonly ok: boolean;
  readonly value?: Wire;
  readonly error?: string;
};

const app = new Hono();
const ingress = 'https://mae.kittycrow.dev/v1/devvit';
const rpcGenerationKey = 'mae:reddit-rpc:generation';

const secret = async (): Promise<string> => {
  const value = await settings.get<string>('maeBridgeSecret');
  if (value === undefined || value.trim().length < 32) {
    throw new Error('maeBridgeSecret is not configured');
  }
  return value.trim();
};

const request = async (path: string, init?: RequestInit): Promise<Response> => {
  const token = await secret();
  return await fetch(`${ingress}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
};

const drain = async (): Promise<void> => {
  const response = await request('/work?wait=25000');
  if (!response.ok) throw new Error(`Mae ingress work request failed with HTTP ${response.status}`);
  const work = await response.json() as Work;
  if (!Array.isArray(work.commands)) throw new Error('Mae ingress returned invalid work');

  for (const command of work.commands) {
    let result: Result;
    try {
      result = {
        id: command.id,
        ok: true,
        value: await execute(command, { reddit, media }),
      };
    } catch (error) {
      result = {
        id: command.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const submitted = await request('/result', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(result),
    });
    if (!submitted.ok) {
      throw new Error(`Mae ingress result submission failed with HTTP ${submitted.status}`);
    }
  }
};

const armRpcWait = async (generation: string): Promise<void> => {
  await scheduler.runJob({
    name: 'mae-reddit-rpc',
    data: { generation },
    runAt: new Date(Date.now() + 100),
  });
};

const startRpcWaitLoop = async (): Promise<void> => {
  const generation = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  await redis.set(rpcGenerationKey, generation);
  await armRpcWait(generation);
};

app.post('/internal/triggers/comment-submit', async c => {
  const input = await c.req.json<OnCommentSubmitRequest>();
  const submitted = await request('/event/comment', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(input),
  });
  if (!submitted.ok) {
    throw new Error(`Mae ingress comment submission failed with HTTP ${submitted.status}`);
  }
  return c.json<TriggerResponse>({ status: 'ok' });
});

app.post('/internal/triggers/app-install', async c => {
  await startRpcWaitLoop();
  return c.json<TriggerResponse>({ status: 'ok' });
});

app.post('/internal/triggers/app-upgrade', async c => {
  await startRpcWaitLoop();
  return c.json<TriggerResponse>({ status: 'ok' });
});

app.post('/internal/scheduler/mae-reddit-rpc', async c => {
  const requestBody = await c.req.json<TaskRequest<{ generation: string }>>();
  const generation = requestBody.data?.generation;
  if (typeof generation !== 'string') return c.json<TaskResponse>({ status: 'ok' });
  if (await redis.get(rpcGenerationKey) !== generation) {
    return c.json<TaskResponse>({ status: 'ok' });
  }

  try {
    await drain();
  } finally {
    if (await redis.get(rpcGenerationKey) === generation) await armRpcWait(generation);
  }
  return c.json<TaskResponse>({ status: 'ok' });
});

export default app;
