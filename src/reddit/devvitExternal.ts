import { isMap, parseJson } from '../types/json.ts';

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
}
