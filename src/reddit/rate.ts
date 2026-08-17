export type RedditRate = {
  readonly used: number | null;
  readonly remaining: number | null;
  readonly resetMs: number | null;
};

const headerNum = (headers: Headers, name: string): number | null => {
  const raw = headers.get(name);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

export const rateFrom = (headers: Headers): RedditRate => {
  const reset = headerNum(headers, 'x-ratelimit-reset');
  return {
    used: headerNum(headers, 'x-ratelimit-used'),
    remaining: headerNum(headers, 'x-ratelimit-remaining'),
    resetMs: reset === null ? null : Math.ceil(reset * 1_000),
  };
};

export const retryAfterMs = (headers: Headers): number | null => {
  const seconds = headerNum(headers, 'retry-after');
  if (seconds !== null) return Math.ceil(seconds * 1_000);
  const rate = rateFrom(headers);
  return rate.remaining !== null && rate.remaining <= 0 ? rate.resetMs : null;
};

export const backoffMs = (attempt: number, random: () => number = Math.random): number => {
  const base = Math.min(30_000, 500 * (2 ** Math.max(0, attempt)));
  return Math.floor(base * (0.75 + random() * 0.5));
};
