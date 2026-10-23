import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Store } from '../store/store.ts';
import { isMap, type Json, type JsonMap } from '../types/json.ts';
import { rateFrom, retryAfterMs } from './rate.ts';

export type RedditRateLimitedFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type RedditRateBudgetSleep = (milliseconds: number) => Promise<void>;

export type RedditRateBudgetOptions = {
  readonly reserve?: number | undefined;
  readonly minimumIntervalMs?: number;
  readonly sleep?: RedditRateBudgetSleep;
  readonly now?: () => number;
  readonly stateFile?: string;
};

const DEFAULT_RESERVE = 5;
const DEFAULT_MINIMUM_INTERVAL_MS = 800;
const OVERRIDE_MINIMUM_INTERVAL_MS = 650;
const OVERRIDE_WINDOW_MS = 120_000;
const SOFT_WAIT_POLL_MS = 1_000;
const UNKNOWN_RESET_MS = 60_000;
const UNKNOWN_429_RESET_MS = 10 * 60_000;
const PROBE_LEASE_MS = 30_000;
const RESET_GRACE_MS = 1_000;

const defaultSleep: RedditRateBudgetSleep = async milliseconds => {
  await new Promise<void>(resolvePromise => setTimeout(resolvePromise, milliseconds));
};

const initial = (): JsonMap => ({
  schema: 1,
  remaining: null,
  resetAtMs: null,
  blockedUntilMs: null,
  hardBlockedUntilMs: null,
  overrideUntilMs: null,
  probeUntilMs: null,
  nextAllowedAtMs: null,
  updatedAtMs: 0,
});

const finiteOrNull = (value: Json | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

const integerOrNull = (value: Json | undefined): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

const root = (value: Json): JsonMap => {
  if (!isMap(value) || value['schema'] !== 1) throw new Error('Unsupported Reddit rate-budget store');
  return value;
};

const stateFileFor = (clientId: string): string => {
  const configured = process.env['REDDIT_RATE_STATE_FILE']?.trim();
  if (configured !== undefined && configured.length > 0) return resolve(process.cwd(), configured);
  const key = createHash('sha256').update(clientId).digest('hex').slice(0, 16);
  return resolve(process.cwd(), 'data', `redditRate-${key}.pb`);
};

const configuredMinimumInterval = (): number => {
  const raw = process.env['REDDIT_RATE_MINIMUM_INTERVAL_MS']?.trim();
  if (raw === undefined || raw.length === 0) return DEFAULT_MINIMUM_INTERVAL_MS;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > 60_000) {
    throw new Error('REDDIT_RATE_MINIMUM_INTERVAL_MS must be an integer from 0 to 60000');
  }
  return value;
};

const requestUrl = (input: string | URL | Request): URL => {
  if (input instanceof Request) return new URL(input.url);
  return new URL(String(input));
};

export class RedditRateBudget {
  private readonly store: Store;
  private readonly reserve: number;
  private readonly minimumIntervalMs: number;
  private readonly sleep: RedditRateBudgetSleep;
  private readonly now: () => number;

  public constructor(clientId: string, options: RedditRateBudgetOptions = {}) {
    const reserve = Math.floor(options.reserve ?? DEFAULT_RESERVE);
    if (!Number.isSafeInteger(reserve) || reserve < 1 || reserve > 99) {
      throw new Error('Reddit rate-budget reserve must be an integer from 1 to 99');
    }
    const minimumIntervalMs = Math.floor(options.minimumIntervalMs ?? configuredMinimumInterval());
    if (!Number.isSafeInteger(minimumIntervalMs) || minimumIntervalMs < 0 || minimumIntervalMs > 60_000) {
      throw new Error('Reddit rate-budget minimum interval must be an integer from 0 to 60000 milliseconds');
    }
    this.reserve = reserve;
    this.minimumIntervalMs = minimumIntervalMs;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
    this.store = new Store(options.stateFile ?? stateFileFor(clientId), initial());
  }

  /**
   * A short-lived override of Mae's local reserve, shared across processes.
   * Actual Reddit HTTP 429 cooldowns cannot be bypassed.
   */
  public async forceUnblock(): Promise<{ readonly ok: boolean; readonly detail: string }> {
    let blocked = false;
    await this.store.edit(current => {
      const value = root(current);
      const now = this.now();
      const hardUntil = integerOrNull(value['hardBlockedUntilMs']);
      const legacyBlockedUntil = integerOrNull(value['blockedUntilMs']);
      const legacyResetAt = integerOrNull(value['resetAtMs']);
      // On old persisted stores, a real 429 wrote resetAtMs exactly equal
      // to blockedUntilMs; a local reserve pause instead used reset+grace.
      const legacyProvider429 = hardUntil === null && legacyBlockedUntil !== null
        && legacyBlockedUntil === legacyResetAt && legacyBlockedUntil > now;
      if ((hardUntil !== null && hardUntil > now) || legacyProvider429) {
        blocked = true;
        return value;
      }
      value['overrideUntilMs'] = now + OVERRIDE_WINDOW_MS;
      value['blockedUntilMs'] = null;
      value['probeUntilMs'] = null;
      value['nextAllowedAtMs'] = now;
      value['updatedAtMs'] = now;
      return value;
    });
    return blocked
      ? { ok: false, detail: 'Reddit returned HTTP 429; its retry window cannot be overridden' }
      : { ok: true, detail: 'Local quota reserve released for two minutes; Reddit HTTP 429 remains enforced' };
  }

  public async acquire(): Promise<void> {
    for (;;) {
      let waitMs = 0;
      await this.store.edit(current => {
        const value = root(current);
        const now = this.now();
        let remaining = finiteOrNull(value['remaining']);
        let resetAtMs = integerOrNull(value['resetAtMs']);
        let blockedUntilMs = integerOrNull(value['blockedUntilMs']);
        const probeUntilMs = integerOrNull(value['probeUntilMs']);
        const nextAllowedAtMs = integerOrNull(value['nextAllowedAtMs']);
        const hardUntil = integerOrNull(value['hardBlockedUntilMs']);
        const overrideUntil = integerOrNull(value['overrideUntilMs']);
        const forced = overrideUntil !== null && overrideUntil > now;

        if (resetAtMs !== null && resetAtMs <= now) {
          remaining = null;
          resetAtMs = null;
          blockedUntilMs = null;
          value['remaining'] = null;
          value['resetAtMs'] = null;
          value['blockedUntilMs'] = null;
          value['hardBlockedUntilMs'] = null;
          value['probeUntilMs'] = null;
        }

        // Provider cooldowns cannot be overridden. Poll soft waits so a
        // dashboard operator can release them without restarting Reddit.
        if (hardUntil !== null && hardUntil > now) {
          waitMs = hardUntil - now;
          return value;
        }
        if (blockedUntilMs !== null && blockedUntilMs > now && !forced) {
          waitMs = Math.min(SOFT_WAIT_POLL_MS, blockedUntilMs - now);
          return value;
        }

        if (nextAllowedAtMs !== null && nextAllowedAtMs > now) {
          waitMs = nextAllowedAtMs - now;
          return value;
        }

        if (remaining === null) {
          if (probeUntilMs !== null && probeUntilMs > now) {
            waitMs = Math.min(1_000, probeUntilMs - now);
            return value;
          }
          value['probeUntilMs'] = now + PROBE_LEASE_MS;
          value['nextAllowedAtMs'] = now + (forced ? Math.min(this.minimumIntervalMs, OVERRIDE_MINIMUM_INTERVAL_MS) : this.minimumIntervalMs);
          value['updatedAtMs'] = now;
          return value;
        }

        if (remaining <= this.reserve && !forced) {
          const reset = resetAtMs ?? now + UNKNOWN_RESET_MS;
          const block = Math.max(now + RESET_GRACE_MS, reset + RESET_GRACE_MS);
          value['resetAtMs'] = reset;
          value['blockedUntilMs'] = block;
          value['updatedAtMs'] = now;
          // Reserve pauses are local policy, not Reddit HTTP 429 blocks.
          // Recheck the shared persisted state frequently so a Dashboard
          // force-unblock wakes a waiting request within one second.
          waitMs = Math.min(SOFT_WAIT_POLL_MS, block - now);
          return value;
        }

        value['remaining'] = Math.max(0, remaining - 1);
        value['nextAllowedAtMs'] = now + (forced ? Math.min(this.minimumIntervalMs, OVERRIDE_MINIMUM_INTERVAL_MS) : this.minimumIntervalMs);
        value['updatedAtMs'] = now;
        return value;
      });

      if (waitMs <= 0) return;
      await this.sleep(waitMs);
    }
  }

  public async observe(response: Response): Promise<void> {
    const observed = rateFrom(response.headers);
    const retry = retryAfterMs(response.headers);
    const now = this.now();

    await this.store.edit(current => {
      const value = root(current);
      const currentRemaining = finiteOrNull(value['remaining']);
      const currentResetAt = integerOrNull(value['resetAtMs']);

      if (observed.remaining !== null) {
        value['remaining'] = currentRemaining === null
          ? observed.remaining
          : Math.min(currentRemaining, observed.remaining);
      }

      if (observed.resetMs !== null) {
        const observedResetAt = now + observed.resetMs;
        value['resetAtMs'] = currentResetAt === null
          ? observedResetAt
          : Math.max(currentResetAt, observedResetAt);
      }

      value['probeUntilMs'] = null;
      value['updatedAtMs'] = now;

      if (response.status === 429) {
        const resetMs = retry ?? observed.resetMs ?? UNKNOWN_429_RESET_MS;
        const blockedUntil = now + Math.max(RESET_GRACE_MS, resetMs) + RESET_GRACE_MS;
        value['remaining'] = 0;
        value['resetAtMs'] = blockedUntil;
        value['blockedUntilMs'] = blockedUntil;
        value['hardBlockedUntilMs'] = blockedUntil;
        value['overrideUntilMs'] = null;
      }

      return value;
    });
  }
}

export const rateLimitedRedditFetch = (
  fetcher: RedditRateLimitedFetch,
  clientId: string,
  options: RedditRateBudgetOptions = {},
): RedditRateLimitedFetch => {
  const budget = new RedditRateBudget(clientId, options);
  return async (input, init) => {
    const url = requestUrl(input);
    if (url.hostname !== 'oauth.reddit.com') return await fetcher(input, init);

    await budget.acquire();
    const response = await fetcher(input, init);
    await budget.observe(response);
    return response;
  };
};
