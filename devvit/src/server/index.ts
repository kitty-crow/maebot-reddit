import { reddit } from '@devvit/web/server';
import { Hono } from 'hono';
import { healthResponse } from './protocol.ts';
import { parseFeedRequest, projectPost, type FeedRequest } from './postFeed.ts';

const app = new Hono();

// Devvit validates the managed token before invoking this external route.
// This is an identity-only preflight; it cannot modify Reddit or Mae's state.
app.post('/external/mae/health', async c => {
  try {
    const account = await reddit.getAppUser();
    if (account === undefined) return c.json({ ok: false, error: 'app_account_unavailable' }, 503);
    return c.json(healthResponse(account.username));
  } catch {
    return c.json({ ok: false, error: 'reddit_unavailable' }, 503);
  }
});

// This endpoint is intentionally read-only. The existing Bun state machine
// remains the sole owner of scheduling, decisions and persistent state.
app.post('/external/mae/read/posts', async c => {
  let request: FeedRequest;
  try {
    const body = await c.req.text();
    if (body.length > 1024) return c.json({ ok: false, error: 'body_too_large' }, 413);
    request = parseFeedRequest(JSON.parse(body));
  } catch {
    return c.json({ ok: false, error: 'invalid_request' }, 400);
  }
  try {
    const installed = await reddit.getCurrentSubredditName();
    if (installed.toLowerCase() !== request.subreddit) {
      return c.json({ ok: false, error: 'installation_mismatch' }, 403);
    }
    const options = { subredditName: installed, limit: request.limit, pageSize: request.limit };
    const posts = request.feed === 'new'
      ? await reddit.getNewPosts(options).all()
      : await reddit.getHotPosts(options).all();
    return c.json({
      protocol: 1,
      subreddit: request.subreddit,
      feed: request.feed,
      posts: posts.map(projectPost),
    });
  } catch {
    return c.json({ ok: false, error: 'reddit_unavailable' }, 503);
  }
});

export default app;
