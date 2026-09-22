import { media, reddit } from '@devvit/web/server';
import { Hono } from 'hono';
import type { AdapterRoots } from './controller.ts';
import { handleLegacyCompat } from './legacyAdapter.ts';
import type { LegacyCompatRequest } from './legacyCompat.ts';

const app = new Hono();
const roots: AdapterRoots = { reddit, media };
const prefix = '/api/reddit';

const record = (params: URLSearchParams): Readonly<Record<string, string>> =>
  Object.fromEntries(params.entries());

const form = async (request: Request): Promise<Readonly<Record<string, string>>> => {
  const type = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') return {};
  return record(new URLSearchParams(await request.text()));
};

app.get('/api/reddit', c => c.json({
  ok: true,
  adapter: 'legacy-reddit-compat',
}));

app.all('/api/reddit/*', async c => {
  const url = new URL(c.req.url);
  const legacyPath = url.pathname.slice(prefix.length);
  if (!legacyPath.startsWith('/')) return c.json({ error: 'invalid Reddit compatibility path' }, 400);

  const method = c.req.method;
  if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') {
    return c.json({ error: 'unsupported method' }, 405);
  }

  const request: LegacyCompatRequest = {
    method,
    path: legacyPath,
    query: record(url.searchParams),
    ...(method === 'GET' ? {} : { form: await form(c.req.raw) }),
  };

  try {
    const response = await handleLegacyCompat(request, roots);
    if (!response.supported) {
      return c.json({
        error: 'unsupported Reddit capability',
        method,
        path: legacyPath,
      }, 501);
    }
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  } catch (error) {
    console.error(
      `[Reddit adapter] ${method} ${legacyPath} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return c.json({ error: 'Reddit adapter operation failed' }, 500);
  }
});

export default app;
