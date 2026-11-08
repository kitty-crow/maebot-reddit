import { reddit } from '@devvit/web/server';
import { Hono } from 'hono';
import { healthResponse } from './protocol.ts';
import { parseModmailReadRequest, projectModmailConversation, projectModmailPage, type ModmailReadRequest } from './modmailRead.ts';
import { parseCommunityRequest, projectModerator, projectRule, projectBannedUser, projectMutedUser, type CommunityReadRequest } from './communityRead.ts';
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
    const installed = (await reddit.getCurrentSubreddit()).name;
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

// These reads never change Mae's canonical stores or subreddit state.
// Local rule metadata is not the entire legacy rules response (site_rules).
app.post('/external/mae/read/community', async c => {
  let request: CommunityReadRequest;
  try {
    const body = await c.req.text();
    if (body.length > 1024) return c.json({ ok: false, error: 'body_too_large' }, 413);
    request = parseCommunityRequest(JSON.parse(body));
  } catch {
    return c.json({ ok: false, error: 'invalid_request' }, 400);
  }
  try {
    const installed = await reddit.getCurrentSubreddit();
    if (installed.name.toLowerCase() !== request.subreddit) {
      return c.json({ ok: false, error: 'installation_mismatch' }, 403);
    }
    if (request.kind === 'moderators') {
      const moderators = await installed.getModerators().all();
      return c.json({
        protocol: 1, subreddit: request.subreddit, kind: request.kind,
        moderators: moderators.map(projectModerator),
      });
    }
    if (request.kind === 'banned' || request.kind === 'muted') {
      // Do not mistake a page-limited listing for a complete moderation inventory.
      const options = { subredditName: installed.name, limit: 1000, pageSize: 100 };
      const users = request.kind === 'banned'
        ? (await reddit.getBannedUsers(options).all()).map(projectBannedUser)
        : (await reddit.getMutedUsers(options).all()).map(projectMutedUser);
      return users.length >= 1000
        ? c.json({ ok: false, error: 'listing_limit_reached' }, 409)
        : c.json({ protocol: 1, subreddit: request.subreddit, kind: request.kind, users });
    }
    const rules = await reddit.getRules(installed.name);
    return c.json({
      protocol: 1, subreddit: request.subreddit, kind: request.kind,
      rules: rules.map(projectRule),
    });
  } catch {
    return c.json({ ok: false, error: 'reddit_unavailable' }, 503);
  }
});

// Modmail previews are read-only: details are always requested with markRead=false.
// The app installation and each returned conversation must belong to the same subreddit.
app.post('/external/mae/read/modmail', async c => {
  let request: ModmailReadRequest;
  try {
    const body = await c.req.text();
    if (body.length > 1024) return c.json({ ok: false, error: 'body_too_large' }, 413);
    request = parseModmailReadRequest(JSON.parse(body));
  } catch {
    return c.json({ ok: false, error: 'invalid_request' }, 400);
  }
  try {
    const installed = (await reddit.getCurrentSubreddit()).name;
    if (installed.toLowerCase() !== request.subreddit) {
      return c.json({ ok: false, error: 'installation_mismatch' }, 403);
    }
    if (request.mode === 'list') {
      const result = await reddit.modMail.getConversations({
        subreddits: [installed],
        limit: request.limit,
        sort: 'recent',
        state: 'all',
        ...(request.after === null ? {} : { after: request.after }),
      });
      return c.json(projectModmailPage(result, request.subreddit, request.limit));
    }
    const result = await reddit.modMail.getConversation({
      conversationId: request.conversationId, markRead: false,
    });
    if (result.conversation === undefined) return c.json({ ok: false, error: 'not_found' }, 404);
    const conversation = projectModmailConversation(result.conversation, request.subreddit);
    if (conversation.id !== request.conversationId) {
      return c.json({ ok: false, error: 'conversation_id_mismatch' }, 502);
    }
    return c.json({ protocol: 1, mode: 'detail', subreddit: request.subreddit, data: { conversation } });
  } catch {
    return c.json({ ok: false, error: 'reddit_unavailable' }, 503);
  }
});

export default app;
