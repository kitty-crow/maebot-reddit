import { isMap, parseJson } from '../types/json.ts';
import { parseDevvitPostFeed, type DevvitPostFeedRequest } from './devvitPostFeed.ts';
import type { RedditPost, RedditModerator, RedditRule } from './types.ts';
import { parseDevvitModerators, parseDevvitLocalRules, type DevvitCommunityKind } from './devvitCommunityRead.ts';
import type { DevvitCommunity } from './devvitPostFeed.ts';

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
  private async readCommunity(subreddit: DevvitCommunity, kind: DevvitCommunityKind): Promise<string> {
    let response: Response;
    try {
      response = await this.fetcher(this.baseUrl + '/external/mae/read/community', {
        method: 'POST',
        headers: {
          authorization: 'bearer ' + this.token,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ subreddit, kind }),
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

}
