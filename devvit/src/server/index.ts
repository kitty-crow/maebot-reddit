import { reddit, redis } from '@devvit/web/server';
import { executeAuthoredWrite, parseAuthoredRequest, type AuthoredRequest, type AuthoredApi } from './authoredWrite.ts';
import { parseInspectionRequest, projectSubreddit, projectPostScore, type InspectionRequest } from './inspectionRead.ts';
import { parseActivityRequest, projectRecentComments, type ActivityRequest } from './activityRead.ts';
import { parseMessageReadRequest, projectMessageFolder, type MessageReadRequest } from './directMessageRead.ts';
import { executeModmailMutation, parseModmailMutation } from './modmailMutation.ts';
import { executeModerationMutation, parseModerationMutation, type ModerationApi } from './moderationMutation.ts';
import { parseModNoteRequest, projectModNote, executeModNoteWrite, type ModNoteApi, type NoteRequest } from './modNotes.ts';
import { createModmailClaimStore } from './modmailMutationStore.ts';
import { Hono } from 'hono';
import { healthResponse } from './protocol.ts';
import { parseModmailReadRequest, projectModmailConversation, projectModmailPage, type ModmailReadRequest } from './modmailRead.ts';
import { parseCommunityRequest, projectModerator, projectRule, projectBannedUser, projectMutedUser, selectRelationship, type CommunityReadRequest } from './communityRead.ts';
import { parseFlairRequest, projectFlairTemplate, projectFlairAssignment, readFlairAssignments, type FlairRequest } from './flairRead.ts';
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
    if (request.kind === 'banned-user' || request.kind === 'muted-user') {
      const options = { subredditName: installed.name, username: request.username, limit: 2, pageSize: 2 };
      const users = request.kind === 'banned-user'
        ? (await reddit.getBannedUsers(options).all()).map(projectBannedUser)
        : (await reddit.getMutedUsers(options).all()).map(projectMutedUser);
      return c.json({ protocol: 1, subreddit: request.subreddit, kind: request.kind,
        user: selectRelationship(users, request.username) });
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

// Write transport is staged only, with no caller in Mae's live state machine.
// A persistent operation claim prevents ambiguous writes from being replayed.
app.post('/external/mae/write/modmail', async c => {
  let request;
  try {
    const body = await c.req.text();
    if (body.length > 12_288) return c.json({ ok: false, error: 'body_too_large' }, 413);
    request = parseModmailMutation(JSON.parse(body));
  } catch {
    return c.json({ ok: false, error: 'invalid_request' }, 400);
  }
  try {
    const installed = (await reddit.getCurrentSubreddit()).name;
    if (installed.toLowerCase() !== request.subreddit) {
      return c.json({ ok: false, error: 'installation_mismatch' }, 403);
    }
    const receipt = await executeModmailMutation(request, reddit.modMail, createModmailClaimStore(redis));
    return c.json(receipt);
  } catch {
    // Never retry an ambiguous write automatically, and never leak Reddit or Redis errors.
    return c.json({ ok: false, error: 'write_not_confirmed_reconcile_before_retry' }, 409);
  }
});

// Preview-only. Canonical Bun moderation and reputation remain authoritative.
app.post('/external/mae/write/moderation', async c => {
  let request;
  try {
    const body = await c.req.text();
    if (body.length > 12_288) return c.json({ ok:false, error:'body_too_large' },413);
    request = parseModerationMutation(JSON.parse(body));
  } catch {
    return c.json({ ok:false, error:'invalid_request' },400);
  }
  try {
    const installed = await reddit.getCurrentSubreddit();
    if (installed.name.toLowerCase() !== request.subreddit) {
      return c.json({ ok:false, error:'installation_mismatch' },403);
    }
    const api: ModerationApi = {
      isModerator: async username => {
        const moderators = await installed.getModerators().all();
        if (moderators.length >= 1000) throw new Error('Moderator listing may be truncated');
        return moderators.some(mod => mod.username.toLowerCase() === username.toLowerCase());
      },
      getThingCommunity: async fullname => {
        const source = fullname.startsWith('t1_')
          ? await reddit.getCommentById(fullname as Parameters<typeof reddit.getCommentById>[0])
          : await reddit.getPostById(fullname as Parameters<typeof reddit.getPostById>[0]);
        return source.subredditName;
      },
      banUser: async options => await reddit.banUser({ ...options, subredditName: installed.name }),
      unbanUser: async (username, _subreddit) => await reddit.unbanUser(username, installed.name),
      unmuteUser: async (username, _subreddit) => await reddit.unmuteUser(username, installed.name),
      remove: async fullname => await reddit.remove(fullname as Parameters<typeof reddit.remove>[0], false),
      setUserFlair: async options => await reddit.setUserFlair({ ...options, subredditName: installed.name }),
      setUserFlairDirect: async options => await reddit.setUserFlair({ ...options, subredditName: installed.name }),
      setPostFlair: async options => await reddit.setPostFlair({
        ...options, subredditName: installed.name,
        postId: options.postId as Parameters<typeof reddit.setPostFlair>[0]['postId'],
      }),
      createFlairTemplate: async ({ kind, template }) => {
        const options = {
          subredditName: installed.name, text: template.text, modOnly: template.modOnly,
          allowUserEdits: template.textEditable,
          ...(template.backgroundColour === null ? {} : { backgroundColor:template.backgroundColour }),
          ...(template.textColour === null ? {} : { textColor:template.textColour }),
          ...(template.allowableContent === null ? {} : { allowableContent:template.allowableContent }),
          ...(template.maxEmojis === null ? {} : { maxEmojis:template.maxEmojis }),
        };
        const value = kind === 'user'
          ? await reddit.createUserFlairTemplate(options)
          : await reddit.createPostFlairTemplate(options);
        return value.id;
      },
    };
    const store = createModmailClaimStore(redis,'mae:moderation:write-claims:v1');
    return c.json(await executeModerationMutation(request,api,store));
  } catch {
    return c.json({ ok:false, error:'write_not_confirmed_reconcile_before_retry' },409);
  }
});

// Read-only flair preview. Template CSS class and assignment UUID can be absent
// from Devvit's SDK and are deliberately not inferred.
app.post('/external/mae/read/flair', async c => {
  let request: FlairRequest;
  try {
    const body = await c.req.text();
    if (body.length > 1024) return c.json({ ok: false, error: 'body_too_large' }, 413);
    request = parseFlairRequest(JSON.parse(body));
  } catch {
    return c.json({ ok: false, error: 'invalid_request' }, 400);
  }
  try {
    const installed = await reddit.getCurrentSubreddit();
    if (installed.name.toLowerCase() !== request.subreddit) {
      return c.json({ ok: false, error: 'installation_mismatch' }, 403);
    }
    if (request.kind === 'user-templates' || request.kind === 'post-templates') {
      const templates = request.kind === 'user-templates'
        ? await reddit.getUserFlairTemplates(installed.name)
        : await reddit.getPostFlairTemplates(installed.name);
      return c.json({ protocol: 1, subreddit: request.subreddit, kind: request.kind,
        templates: templates.map(projectFlairTemplate) });
    }
    if (request.kind === 'user-assignments') {
      const assignments = await readFlairAssignments(installed);
      return c.json({ protocol: 1, subreddit: request.subreddit, kind: request.kind, assignments });
    }
    const username = request.username;
    if (username === null) return c.json({ ok: false, error: 'invalid_request' }, 400);
    const user = await reddit.getUserByUsername(username);
    const flair = user === undefined ? undefined : await user.getUserFlairBySubreddit(installed.name);
    if (flair?.user !== undefined && flair.user.toLowerCase() !== username.toLowerCase()) {
      throw new Error('User flair lookup returned the wrong username');
    }
    return c.json({ protocol: 1, subreddit: request.subreddit, kind: request.kind,
      assignment: flair === undefined ? null : projectFlairAssignment(flair) });
  } catch {
    return c.json({ ok: false, error: 'reddit_unavailable' }, 503);
  }
});

// Native Mod Notes read/write previews. The canonical Bun store still decides
// what to publish; no production code invokes these operations.
app.post('/external/mae/read/modnotes', async c => {
  let request: Extract<NoteRequest, { readonly kind: 'list' }>;
  try {
    const body=await c.req.text();
    if(body.length>1024)return c.json({ok:false,error:'body_too_large'},413);
    const parsed=parseModNoteRequest(JSON.parse(body));
    if(parsed.kind!=='list')return c.json({ok:false,error:'invalid_request'},400);
    request=parsed;
  } catch {
    return c.json({ok:false,error:'invalid_request'},400);
  }
  try {
    const installed=(await reddit.getCurrentSubreddit()).name;
    if(installed.toLowerCase()!==request.subreddit)return c.json({ok:false,error:'installation_mismatch'},403);
    const notes=await reddit.getModNotes({
      subreddit:installed,user:request.username,filter:'NOTE',limit:request.limit,
    }).get(request.limit);
    return c.json({protocol:1,subreddit:request.subreddit,kind:'list',username:request.username,
      notes:notes.map(note=>projectModNote(note,request.subreddit,request.username))});
  } catch {
    return c.json({ok:false,error:'reddit_unavailable'},503);
  }
});
app.post('/external/mae/write/modnotes', async c => {
  let request: Extract<NoteRequest, { readonly kind: 'add' | 'delete' }>;
  try {
    const body=await c.req.text();
    if(body.length>12_288)return c.json({ok:false,error:'body_too_large'},413);
    const parsed=parseModNoteRequest(JSON.parse(body));
    if(parsed.kind==='list')return c.json({ok:false,error:'invalid_request'},400);
    request=parsed;
  } catch {
    return c.json({ok:false,error:'invalid_request'},400);
  }
  try {
    const installed=(await reddit.getCurrentSubreddit()).name;
    if(installed.toLowerCase()!==request.subreddit)return c.json({ok:false,error:'installation_mismatch'},403);
    const api:ModNoteApi={
      addModNote:async ({redditId,...options})=>await reddit.addModNote({
        ...options,
        ...(redditId===undefined?{}:{redditId:redditId as Parameters<typeof reddit.addModNote>[0]['redditId']}),
      }),
      deleteModNote:async options=>await reddit.deleteModNote(options),
    };
    const receipt=await executeModNoteWrite(request,api,
      createModmailClaimStore(redis,'mae:modnotes:write-claims:v1'),installed);
    return c.json(receipt);
  } catch {
    return c.json({ok:false,error:'write_not_confirmed_reconcile_before_retry'},409);
  }
});

// Non-mutating inspection of the installed subreddit and requested posts.
// Comment score parity is intentionally not claimed because Devvit's Comment
// model omits the archived flag from Mae's original /api/info response.
const inspectInstalledSubreddit = async (
  installed: Awaited<ReturnType<typeof reddit.getCurrentSubreddit>>,
  community: Extract<InspectionRequest,{readonly kind:'subreddit'}>['subreddit'],
) => {
  const appUser = await reddit.getAppUser();
  if (appUser === undefined) throw new Error('Reddit app identity missing');
  const mods = await installed.getModerators().all();
  if (mods.length >= 1000) throw new Error('Moderator listing may be incomplete');
  const isMod = mods.some(mod => mod.username.toLowerCase() === appUser.username.toLowerCase());
  return projectSubreddit(installed,community,isMod);
};
app.post('/external/mae/read/inspection', async c => {
  let request: InspectionRequest;
  try {
    const body = await c.req.text();
    if (body.length > 2048) return c.json({ok:false,error:'body_too_large'},413);
    request = parseInspectionRequest(JSON.parse(body));
  } catch {
    return c.json({ok:false,error:'invalid_request'},400);
  }
  try {
    const installed = await reddit.getCurrentSubreddit();
    if (installed.name.toLowerCase() !== request.subreddit) {
      return c.json({ok:false,error:'installation_mismatch'},403);
    }
    if (request.kind === 'subreddit') {
      const data = await inspectInstalledSubreddit(installed,request.subreddit);
      return c.json({protocol:1,subreddit:request.subreddit,kind:request.kind,data});
    }
    const scores = [];
    for (const fullname of request.fullnames) {
      const post = await reddit.getPostById(fullname as Parameters<typeof reddit.getPostById>[0]);
      scores.push(projectPostScore(post,request.subreddit,fullname));
    }
    return c.json({protocol:1,subreddit:request.subreddit,kind:request.kind,scores});
  } catch {
    return c.json({ok:false,error:'reddit_unavailable'},503);
  }
});

// This is a preview for the legacy member Mod Notes comment assessor. The SDK
// does not expose all original comment link-context fields, so no live routing.
app.post('/external/mae/read/activity', async c => {
  let request: ActivityRequest;
  try {
    const body=await c.req.text();
    if (body.length > 1024) return c.json({ok:false,error:'body_too_large'},413);
    request=parseActivityRequest(JSON.parse(body));
  } catch {
    return c.json({ok:false,error:'invalid_request'},400);
  }
  try {
    const installed=await reddit.getCurrentSubreddit();
    if (installed.name.toLowerCase() !== request.installation) {
      return c.json({ok:false,error:'installation_mismatch'},403);
    }
    const comments=await reddit.getCommentsByUser({
      username:request.username,sort:'new',timeframe:'all',
      limit:request.maxScanned,pageSize:100,
    }).all();
    return c.json({protocol:1,installation:request.installation,username:request.username,
      comments:projectRecentComments(comments,request)});
  } catch {
    return c.json({ok:false,error:'reddit_unavailable'},503);
  }
});

// Deliberately not a canonical RedditDirectMessage decoder: Devvit omits
// subject, recipient, parent and unread flags required by Mae's DM state.
app.post('/external/mae/read/messages', async c => {
  let request: MessageReadRequest;
  try {
    const body=await c.req.text();
    if (body.length>1024) return c.json({ok:false,error:'body_too_large'},413);
    request=parseMessageReadRequest(JSON.parse(body));
  } catch {
    return c.json({ok:false,error:'invalid_request'},400);
  }
  try {
    const installed=(await reddit.getCurrentSubreddit()).name;
    if (installed.toLowerCase()!==request.installation) {
      return c.json({ok:false,error:'installation_mismatch'},403);
    }
    const listing=await reddit.getMessages({
      type:request.folder,limit:request.limit,pageSize:100,
    });
    const messages=projectMessageFolder(await listing.all(),request.limit);
    return c.json({protocol:1,installation:request.installation,folder:request.folder,
      accountScope:'app',messages});
  } catch {
    return c.json({ok:false,error:'reddit_unavailable'},503);
  }
});

// Staged only: the canonical Bun publishing and DM code does not call this.
// Never submit as the Devvit app when Mae expects a different Reddit author.
app.post('/external/mae/write/authored', async c => {
  let request: AuthoredRequest;
  try {
    const body = await c.req.text();
    if (body.length > 300_000) return c.json({ok:false,error:'body_too_large'},413);
    request = parseAuthoredRequest(JSON.parse(body));
  } catch {
    return c.json({ok:false,error:'invalid_request'},400);
  }
  try {
    const installed = (await reddit.getCurrentSubreddit()).name;
    if (installed.toLowerCase() !== request.subreddit) {
      return c.json({ok:false,error:'installation_mismatch'},403);
    }
    const appUser = await reddit.getAppUser();
    if (appUser === undefined || appUser.username.toLowerCase() !== request.expectedAuthor.toLowerCase()) {
      return c.json({ok:false,error:'author_identity_mismatch'},403);
    }
    const api: AuthoredApi = {
      getAppUsername: async () => (await reddit.getAppUser())?.username ?? null,
      submitSelf: async options => {
        const post = await reddit.submitPost(options);
        return {id:post.id,subredditName:post.subredditName,authorName:post.authorName,permalink:post.permalink};
      },
      crosspost: async options => {
        const post=await reddit.crosspost({
          ...options,
          postId:options.postId as Parameters<typeof reddit.crosspost>[0]['postId'],
        });
        return {id:post.id,subredditName:post.subredditName,authorName:post.authorName,permalink:post.permalink};
      },
      sendPrivateMessage: async options => await reddit.sendPrivateMessage(options),
      markPrivateMessageRead: async fullname => {
        const unread = await reddit.getMessages({type:'unread',limit:1000,pageSize:100}).all();
        const match = unread.find(message => message.id === fullname);
        if (match === undefined) throw new Error('Native message not found in unread inbox');
        await match.markAsRead();
      },
    };
    const claims=createModmailClaimStore(redis,'mae:authored:write-claims:v1');
    return c.json(await executeAuthoredWrite(request,installed,api,claims));
  } catch {
    return c.json({ok:false,error:'write_not_confirmed_reconcile_before_retry'},409);
  }
});

export default app;
