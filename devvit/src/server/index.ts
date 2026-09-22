import { reddit } from '@devvit/web/server';
import { Hono } from 'hono';

const app = new Hono();

/**
 * Minimal Devvit presence endpoint.
 *
 * Mae does not call this endpoint and does not route Reddit operations through
 * Devvit yet. Production Reddit behaviour remains on the existing OAuth/Data
 * API implementation. This endpoint only proves that the registered Devvit app
 * is alive and can resolve its injected Reddit app identity.
 */
app.get('/api/status', async c => {
  try {
    const account = await reddit.getAppUser();
    return c.json({
      ok: true,
      app: 'this-is-the-mae',
      redditUser: account.username,
      routing: 'oauth',
    });
  } catch (error) {
    console.error(
      `[Devvit status] failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return c.json({
      ok: false,
      app: 'this-is-the-mae',
      routing: 'oauth',
    }, 500);
  }
});

export default app;
