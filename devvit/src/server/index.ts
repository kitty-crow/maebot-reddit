import { reddit } from '@devvit/web/server';
import { Hono } from 'hono';
import { healthResponse } from './protocol.ts';

const app = new Hono();

// Devvit validates the managed token before invoking this external route.
// This is an identity-only preflight; it cannot modify Reddit or Mae's state.
app.post('/external/mae/health', async c => {
  try {
    const account = await reddit.getAppUser();
    return c.json(healthResponse(account.username));
  } catch {
    return c.json({ ok: false, error: 'reddit_unavailable' }, 503);
  }
});

export default app;
