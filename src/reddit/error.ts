export type RedditErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'forbidden'
  | 'not_found'
  | 'bad_request'
  | 'server'
  | 'network'
  | 'invalid_response'
  | 'unknown';

export class RedditError extends Error {
  public constructor(
    message: string,
    public readonly kind: RedditErrorKind,
    public readonly status: number | null = null,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'RedditError';
  }
}

export const safeError = (error: Parameters<Console['error']>[number]): string => {
  if (error instanceof RedditError) {
    const status = error.status === null ? '' : ` HTTP ${error.status}`;
    return `${error.kind}${status}: ${error.message}`;
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
};

export const statusKind = (status: number): RedditErrorKind => {
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limit';
  if (status >= 400 && status < 500) return 'bad_request';
  if (status >= 500) return 'server';
  return 'unknown';
};
