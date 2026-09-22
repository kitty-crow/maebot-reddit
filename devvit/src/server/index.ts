import { media, reddit } from '@devvit/web/server';
import { Hono } from 'hono';
import {
  executeAdapterCommand,
  type AdapterCommand,
  type Wire,
} from './controller.ts';

type AdapterSuccess = {
  readonly id: string;
  readonly ok: true;
  readonly value: Wire;
};

type AdapterFailure = {
  readonly id: string | null;
  readonly ok: false;
  readonly error: {
    readonly name: string;
    readonly message: string;
  };
};

type AdapterResponse = AdapterSuccess | AdapterFailure;

const app = new Hono();

const commandId = (value: unknown): string | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const id = Reflect.get(value, 'id');
  return typeof id === 'string' ? id : null;
};

const failure = (id: string | null, error: unknown): AdapterFailure => ({
  id,
  ok: false,
  error: {
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
  },
});

app.get('/api/adapter/health', c => c.json({ ok: true }));

app.post('/api/adapter', async c => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json<AdapterResponse>(failure(null, new Error('Adapter request body must be JSON')), 400);
  }

  const id = commandId(raw);
  try {
    const value = await executeAdapterCommand(raw as AdapterCommand, { reddit, media });
    return c.json<AdapterResponse>({
      id: id ?? '',
      ok: true,
      value,
    });
  } catch (error) {
    return c.json<AdapterResponse>(failure(id, error), 400);
  }
});

export default app;
