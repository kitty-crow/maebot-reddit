import type { Json } from '../types/json.ts';
import { isMap, parseJson } from '../types/json.ts';
import { RedditError, statusKind } from './error.ts';

export type RedditAdapterMethod = 'GET' | 'POST' | 'DELETE';

export type RedditAdapterRequest = {
  readonly method: RedditAdapterMethod;
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly form?: Readonly<Record<string, string>>;
};

export type RedditAdapterResult =
  | { readonly supported: false }
  | {
      readonly supported: true;
      readonly status: number;
      readonly body: Json;
    };

export type RedditAdapterHandler = (
  request: RedditAdapterRequest,
) => Promise<RedditAdapterResult>;

export type RedditAdapterCfg = {
  readonly base: string;
  readonly token: string;
};

export type RedditAdapterFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const record = (value: Json | undefined): Readonly<Record<string, string>> | undefined => {
  if (value === undefined) return undefined;
  if (!isMap(value)) throw new RedditError('Reddit adapter returned an invalid request map', 'invalid_response');
  const out: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    if (typeof child !== 'string') {
      throw new RedditError('Reddit adapter returned a non-string request-map value', 'invalid_response');
    }
    out[key] = child;
  }
  return out;
};

const result = (value: Json): RedditAdapterResult => {
  if (!isMap(value) || typeof value['supported'] !== 'boolean') {
    throw new RedditError('Reddit adapter response was invalid', 'invalid_response');
  }
  if (value['supported'] === false) return { supported: false };

  const status = value['status'];
  if (typeof status !== 'number' || !Number.isSafeInteger(status) || status < 100 || status > 599) {
    throw new RedditError('Reddit adapter response status was invalid', 'invalid_response');
  }
  return {
    supported: true,
    status,
    body: value['body'] ?? null,
  };
};

const requestParts = (
  method: RedditAdapterMethod,
  rawPath: string,
  body: URLSearchParams | null,
): RedditAdapterRequest => {
  const url = new URL(rawPath, 'https://oauth.reddit.invalid');
  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (key === 'raw_json') continue;
    query[key] = value;
  }
  const form: Record<string, string> = {};
  if (body !== null) {
    for (const [key, value] of body) form[key] = value;
  }
  return {
    method,
    path: url.pathname,
    ...(Object.keys(query).length === 0 ? {} : { query }),
    ...(Object.keys(form).length === 0 ? {} : { form }),
  };
};

export class RedditAdapterClient {
  private readonly endpoint: string;

  public constructor(
    cfg: RedditAdapterCfg,
    private readonly fetcher: RedditAdapterFetch = fetch,
  ) {
    const base = new URL(cfg.base);
    if (
      base.protocol !== 'http:'
      || (base.hostname !== '127.0.0.1' && base.hostname !== '::1' && base.hostname !== 'localhost')
      || base.username.length > 0
      || base.password.length > 0
    ) {
      throw new Error('Reddit adapter must use the loopback HTTP listener');
    }
    if (cfg.token.trim().length === 0) throw new Error('Reddit adapter token is required');
    this.endpoint = new URL('/v1/reddit-adapter', base).toString();
    this.token = cfg.token;
  }

  private readonly token: string;

  public async request(
    method: RedditAdapterMethod,
    path: string,
    body: URLSearchParams | null = null,
  ): Promise<Json | undefined> {
    let response: Response;
    try {
      response = await this.fetcher(this.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(requestParts(method, path, body)),
      });
    } catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      throw new RedditError(`Reddit adapter request failed: ${detail}`, 'network');
    }

    const raw = await response.text();
    let payload: Json;
    try {
      payload = raw.trim().length === 0 ? null : parseJson(raw);
    } catch {
      throw new RedditError('Reddit adapter returned invalid JSON', 'invalid_response', response.status);
    }

    if (!response.ok) {
      throw new RedditError(
        'Reddit adapter request failed',
        statusKind(response.status),
        response.status,
      );
    }

    const adapted = result(payload);
    if (!adapted.supported) return undefined;
    if (adapted.status < 200 || adapted.status >= 300) {
      throw new RedditError(
        'Reddit adapter operation failed',
        statusKind(adapted.status),
        adapted.status,
      );
    }
    return adapted.body;
  }
}

export const adapterRequestFromJson = (value: Json): RedditAdapterRequest | null => {
  if (!isMap(value)) return null;
  const method = value['method'];
  const path = value['path'];
  if (
    (method !== 'GET' && method !== 'POST' && method !== 'DELETE')
    || typeof path !== 'string'
    || !path.startsWith('/')
    || path.length > 2_048
  ) return null;
  try {
    const query = record(value['query']);
    const form = record(value['form']);
    return {
      method,
      path,
      ...(query === undefined ? {} : { query }),
      ...(form === undefined ? {} : { form }),
    };
  } catch {
    return null;
  }
};
