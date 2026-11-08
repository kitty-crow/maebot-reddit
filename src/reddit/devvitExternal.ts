import { isMap, parseJson } from '../types/json.ts';
import { parseDevvitPostFeed, type DevvitPostFeedRequest } from './devvitPostFeed.ts';
import type { RedditPost, RedditModerator, RedditRule } from './types.ts';
import { parseDevvitModerators, parseDevvitLocalRules, parseDevvitRelationships, parseDevvitSingleRelationship, type DevvitCommunityKind } from './devvitCommunityRead.ts';
import type { RedditRelationshipUser } from './decode.ts';
import { validateDevvitModerationRequest, parseDevvitModerationReceipt, type DevvitModerationRequest, type DevvitModerationReceipt } from './devvitModerationMutation.ts';
import type { DevvitCommunity } from './devvitPostFeed.ts';
import { parseDevvitModmailPage, parseDevvitModmailDetail, type DevvitModmailPageRequest } from './devvitModmailRead.ts';
import { validateModmailMutation, parseModmailMutationReceipt, type DevvitModmailMutation, type DevvitMutationReceipt } from './devvitModmailMutation.ts';
import type { ModmailConversation, ModmailConversationPage } from '../modmail/types.ts';
import { parseDevvitNoteListing, parseDevvitNoteReceipt, validateDevvitNoteWrite, type DevvitModNoteRequest, type DevvitNativeNote, type DevvitNoteReceipt } from './devvitModNotes.ts';
import { parseDevvitFlairTemplates, parseDevvitFlairAssignments, parseDevvitFlairAssignment, type DevvitFlairKind } from './devvitFlairRead.ts';
import type { RedditFlairTemplate, RedditFlairAssignment } from './types.ts';

export type DevvitExternalConfig = {
  readonly baseUrl: string;
  readonly managedToken: string;
};

export type DevvitProbe = {
  readonly ok: true;
  readonly protocol: 1;
  readonly app: 'this-is-the-mae';
  readonly redditUser: string;
};

export type DevvitExternalFetch = (url: string, init: RequestInit) => Promise<Response>;

const hostPattern = /^this-is-the-mae-[a-z0-9_-]+-external\.devvit\.net$/iu;

export class DevvitExternalClient {
  private readonly baseUrl: string;
  private readonly token: string;

  public constructor(
    config: DevvitExternalConfig,
    private readonly fetcher: DevvitExternalFetch = fetch,
  ) {
    const url = new URL(config.baseUrl);
    if (url.protocol !== 'https:' || !hostPattern.test(url.hostname)) {
      throw new Error('Devvit external URL must target a this-is-the-mae installation');
    }
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port) {
      throw new Error('Devvit external URL must contain only the installation origin');
    }
    if (!config.managedToken.startsWith('devvit_at_') || config.managedToken.length < 20) {
      throw new Error('Devvit managed token is missing or invalid');
    }
    this.baseUrl = url.origin;
    this.token = config.managedToken;
  }

  public async probe(): Promise<DevvitProbe> {
    let response: Response;
    try {
      response = await this.fetcher(this.baseUrl + '/external/mae/health', {
        method: 'POST',
        headers: {
          authorization: 'bearer ' + this.token,
          accept: 'application/json',
        },
      });
    } catch {
      throw new Error('Devvit external endpoint could not be reached');
    }
    if (!response.ok) throw new Error('Devvit external endpoint returned HTTP ' + response.status);

    const body = await response.text();
    if (body.length > 4096) throw new Error('Devvit health response exceeds maximum size');
    const value = parseJson(body);
    if (!isMap(value) || value['ok'] !== true || value['protocol'] !== 1
        || value['app'] !== 'this-is-the-mae' || typeof value['redditUser'] !== 'string'
        || value['redditUser'].trim().length === 0) {
      throw new Error('Devvit health response violates protocol');
    }
    return {
      ok: true,
      protocol: 1,
      app: 'this-is-the-mae',
      redditUser: value['redditUser'],
    };
  }
  // No production call site until all RedditReadClient operations pass parity tests.
  public async readPosts(request: DevvitPostFeedRequest): Promise<readonly RedditPost[]> {
    if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 100) {
      throw new Error('Invalid Devvit read limit');
    }
    let response: Response;
    try {
      response = await this.fetcher(this.baseUrl + '/external/mae/read/posts', {
        method: 'POST',
        headers: {
          authorization: 'bearer ' + this.token,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(request),
      });
    } catch {
      throw new Error('Devvit post feed could not be reached');
    }
    if (!response.ok) throw new Error('Devvit post feed returned HTTP ' + response.status);
    return parseDevvitPostFeed(await response.text(), request);
  }

  // Local rules are deliberately NOT a substitute for the old rules()
  // response, which also includes Reddit site-wide rules.
  private async readCommunity(subreddit: DevvitCommunity, kind: DevvitCommunityKind, username: string | null = null): Promise<string> {
    let response: Response;
    try {
      response = await this.fetcher(this.baseUrl + '/external/mae/read/community', {
        method: 'POST',
        headers: {
          authorization: 'bearer ' + this.token,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(username === null ? { subreddit, kind } : { subreddit, kind, username }),
      });
    } catch {
      throw new Error('Devvit community read could not be reached');
    }
    if (!response.ok) throw new Error('Devvit community read returned HTTP ' + response.status);
    return await response.text();
  }

  public async readModerators(subreddit: DevvitCommunity): Promise<readonly RedditModerator[]> {
    return parseDevvitModerators(await this.readCommunity(subreddit, 'moderators'), subreddit);
  }

  public async readLocalRules(subreddit: DevvitCommunity): Promise<readonly RedditRule[]> {
    return parseDevvitLocalRules(await this.readCommunity(subreddit, 'local-rules'), subreddit);
  }

  public async readBannedUsers(subreddit: DevvitCommunity): Promise<readonly RedditRelationshipUser[]> {
    return parseDevvitRelationships(await this.readCommunity(subreddit, 'banned'), subreddit, 'banned');
  }

  public async readMutedUsers(subreddit: DevvitCommunity): Promise<readonly RedditRelationshipUser[]> {
    return parseDevvitRelationships(await this.readCommunity(subreddit, 'muted'), subreddit, 'muted');
  }

  public async readBannedUser(
    subreddit: DevvitCommunity, username: string,
  ): Promise<RedditRelationshipUser | null> {
    if (!/^[a-z0-9_-]{2,32}$/iu.test(username)) throw new Error('Invalid banned user lookup name');
    return parseDevvitSingleRelationship(
      await this.readCommunity(subreddit, 'banned-user', username), subreddit, 'banned-user', username,
    );
  }
  public async readMutedUser(
    subreddit: DevvitCommunity, username: string,
  ): Promise<RedditRelationshipUser | null> {
    if (!/^[a-z0-9_-]{2,32}$/iu.test(username)) throw new Error('Invalid muted user lookup name');
    return parseDevvitSingleRelationship(
      await this.readCommunity(subreddit, 'muted-user', username), subreddit, 'muted-user', username,
    );
  }

  private async readModmail(
    request: Readonly<Record<string, string | number | null>>,
  ): Promise<string> {
    let response: Response;
    try {
      response = await this.fetcher(this.baseUrl + '/external/mae/read/modmail', {
        method: 'POST',
        headers: {
          authorization: 'bearer ' + this.token,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(request),
      });
    } catch {
      throw new Error('Devvit Modmail endpoint could not be reached');
    }
    if (!response.ok) throw new Error('Devvit Modmail endpoint returned HTTP ' + response.status);
    return await response.text();
  }

  // Staged only. Never marks a conversation read or mutates a canonical store.
  public async previewModmailConversations(
    subreddit: DevvitCommunity,
    limit = 100,
    after: string | null = null,
  ): Promise<ModmailConversationPage> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Invalid Devvit Modmail page size');
    }
    const request: DevvitModmailPageRequest = { subreddit, limit, after };
    const body = await this.readModmail({ ...request, mode: 'list' });
    return parseDevvitModmailPage(body, request);
  }

  public async previewModmailConversation(
    subreddit: DevvitCommunity,
    conversationId: string,
  ): Promise<ModmailConversation> {
    const body = await this.readModmail({ subreddit, mode: 'detail', conversationId });
    return parseDevvitModmailDetail(body, subreddit, conversationId);
  }

  // Staged only. The caller supplies a stable canonical operation ID and must
  // never automatically reissue an HTTP error (outcome may be ambiguous).
  public async mutateModmail(request: DevvitModmailMutation): Promise<DevvitMutationReceipt> {
    validateModmailMutation(request);
    let response: Response;
    try {
      response = await this.fetcher(this.baseUrl + '/external/mae/write/modmail', {
        method: 'POST',
        headers: {
          authorization: 'bearer ' + this.token,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(request),
      });
    } catch {
      throw new Error('Devvit Modmail mutation outcome uncertain; reconcile before retry');
    }
    if (!response.ok) {
      throw new Error('Devvit Modmail mutation HTTP ' + response.status + '; reconcile before retry');
    }
    return parseModmailMutationReceipt(await response.text(), request.operationId);
  }

  // Still preview-only. Mae's canonical state and mutation gate are not rewired.
  // Network and HTTP errors must never trigger an automatic retry of a write.
  public async mutateModeration(request: DevvitModerationRequest): Promise<DevvitModerationReceipt> {
    validateDevvitModerationRequest(request);
    let response: Response;
    try {
      response = await this.fetcher(this.baseUrl + '/external/mae/write/moderation', {
        method: 'POST',
        headers: {
          authorization: 'bearer ' + this.token,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(request),
      });
    } catch {
      throw new Error('Devvit moderation outcome uncertain; reconcile before retry');
    }
    if (!response.ok) throw new Error('Devvit moderation HTTP ' + response.status + '; reconcile before retry');
    return parseDevvitModerationReceipt(await response.text(), request.operationId);
  }

  private async flairRead(
    subreddit: DevvitCommunity, kind: DevvitFlairKind, username: string | null = null,
  ): Promise<string> {
    let response: Response;
    try {
      response = await this.fetcher(this.baseUrl + '/external/mae/read/flair', {
        method: 'POST',
        headers: {
          authorization: 'bearer ' + this.token,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(username === null ? { subreddit, kind } : { subreddit, kind, username }),
      });
    } catch {
      throw new Error('Devvit flair endpoint could not be reached');
    }
    if (!response.ok) throw new Error('Devvit flair read returned HTTP ' + response.status);
    return await response.text();
  }

  // Partial parity: Devvit omits the legacy CSS class on templates, and
  // omits template UUID on user flair assignments.
  public async readFlairTemplates(
    subreddit: DevvitCommunity, type: 'user' | 'post',
  ): Promise<readonly RedditFlairTemplate[]> {
    const kind = type === 'user' ? 'user-templates' : 'post-templates';
    return parseDevvitFlairTemplates(await this.flairRead(subreddit, kind), subreddit, kind);
  }
  public async readFlairAssignments(subreddit: DevvitCommunity): Promise<readonly RedditFlairAssignment[]> {
    return parseDevvitFlairAssignments(await this.flairRead(subreddit, 'user-assignments'), subreddit);
  }
  public async readFlairAssignment(
    subreddit: DevvitCommunity, username: string,
  ): Promise<RedditFlairAssignment | null> {
    if (!/^[a-z0-9_-]{2,32}$/iu.test(username)) throw new Error('Invalid user flair lookup name');
    return parseDevvitFlairAssignment(
      await this.flairRead(subreddit, 'user-assignment', username), subreddit, username,
    );
  }

  public async readModNotes(
    subreddit: DevvitCommunity, username: string, limit = 100,
  ): Promise<readonly DevvitNativeNote[]> {
    if (!/^[a-z0-9_-]{1,32}$/iu.test(username) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Invalid Devvit Mod Note listing request');
    }
    const body=await this.requestModNotes('/external/mae/read/modnotes',{
      subreddit,username,kind:'list',limit,
    });
    return parseDevvitNoteListing(body,subreddit,username,limit);
  }
  // Writes must never be retried on an uncertain network outcome.
  public async mutateModNote(request: DevvitModNoteRequest): Promise<DevvitNoteReceipt> {
    validateDevvitNoteWrite(request);
    const body=await this.requestModNotes('/external/mae/write/modnotes',request);
    return parseDevvitNoteReceipt(body,request);
  }
  private async requestModNotes(
    endpoint: string, body: Readonly<Record<string,string|number|null>>,
  ): Promise<string> {
    let response:Response;
    try {
      response=await this.fetcher(this.baseUrl+endpoint,{
        method:'POST',
        headers:{
          authorization:'bearer '+this.token,
          'content-type':'application/json',
          accept:'application/json',
        },
        body:JSON.stringify(body),
      });
    } catch {
      throw new Error('Devvit native Mod Notes outcome uncertain; do not retry writes');
    }
    if (!response.ok) throw new Error('Devvit native Mod Notes returned HTTP '+response.status+'; reconcile before retry');
    return await response.text();
  }

}
