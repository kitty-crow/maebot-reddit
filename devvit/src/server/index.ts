import { media, reddit } from '@devvit/web/server';
import { Hono } from 'hono';
import {
  handleLegacyRequest,
  type LegacyCompatRequest,
} from './legacyCompat.ts';

type RequestBody = {
  readonly method?: unknown;
  readonly path?: unknown;
  readonly query?: unknown;
  readonly form?: unknown;
};

const app = new Hono();
const roots = { reddit, media };

const stringRecord = (value: unknown): Readonly<Record<string, string>> | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Adapter query/form must be an object');
  }
  const out: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    if (typeof child !== 'string') throw new Error('Adapter query/form values must be strings');
    out[key] = child;
  }
  return out;
};

const request = (value: unknown): LegacyCompatRequest => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Adapter request body must be an object');
  }
  const raw = value as RequestBody;
  if (raw.method !== 'GET' && raw.method !== 'POST' && raw.method !== 'DELETE') {
    throw new Error('Adapter method is invalid');
  }
  if (typeof raw.path !== 'string' || !raw.path.startsWith('/') || raw.path.length > 2_048) {
    throw new Error('Adapter path is invalid');
  }
  const query = stringRecord(raw.query);
  const form = stringRecord(raw.form);
  return {
    method: raw.method,
    path: raw.path,
    ...(query === undefined ? {} : { query }),
    ...(form === undefined ? {} : { form }),
  };
};

app.get('/api/adapter/health', c => c.json({ ok: true }));

app.post('/api/reddit', async c => {
  try {
    const result = await handleLegacyRequest(request(await c.req.json()), roots);
    return c.json(result);
  } catch (error) {
    return c.json({
      supported: true,
      status: 400,
      body: {
        error: error instanceof Error ? error.message : String(error),
      },
    }, 400);
  }
});

export default app;
