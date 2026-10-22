import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RedditRateBudget } from '../src/reddit/rateBudget.ts';

const dirs: string[] = [];

const stateFile = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'mae-reddit-rate-'));
  dirs.push(dir);
  return join(dir, 'rate.pb');
};

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(async dir => await rm(dir, { recursive: true, force: true })));
});

describe('shared Reddit rate budget', () => {
  test('coordinates independent instances through one persisted remaining budget', async () => {
    const file = await stateFile();
    let now = 1_000;
    const sleeps: number[] = [];
    const sleep = async (milliseconds: number): Promise<void> => {
      sleeps.push(milliseconds);
      now += milliseconds;
    };

    const options = {
      stateFile: file,
      reserve: 30,
      minimumIntervalMs: 0,
      now: () => now,
      sleep,
    } as const;
    const first = new RedditRateBudget('client', options);
    const second = new RedditRateBudget('client', options);

    await first.acquire();
    await first.observe(new Response('', {
      status: 200,
      headers: {
        'x-ratelimit-used': '960',
        'x-ratelimit-remaining': '40',
        'x-ratelimit-reset': '60',
      },
    }));

    for (let i = 0; i < 10; i += 1) await second.acquire();
    expect(sleeps).toEqual([]);

    await first.acquire();
    expect(sleeps.length).toBeGreaterThanOrEqual(60);
    expect(sleeps.reduce((total, ms) => total + ms, 0)).toBeGreaterThanOrEqual(60_000);
  }, 15_000);

  test('paces independent instances through one shared 800ms request slot', async () => {
    const file = await stateFile();
    let now = 1_000;
    const sleeps: number[] = [];
    const sleep = async (milliseconds: number): Promise<void> => {
      sleeps.push(milliseconds);
      now += milliseconds;
    };

    const first = new RedditRateBudget('client', { stateFile: file, now: () => now, sleep });
    const second = new RedditRateBudget('client', { stateFile: file, now: () => now, sleep });

    await first.acquire();
    await first.observe(new Response('', {
      status: 200,
      headers: {
        'x-ratelimit-remaining': '999',
        'x-ratelimit-reset': '600',
      },
    }));
    await second.acquire();

    expect(sleeps).toEqual([800]);
  });

  test('a 429 blocks the shared budget for the reset window instead of retrying immediately', async () => {
    const file = await stateFile();
    let now = 10_000;
    const sleeps: number[] = [];
    const sleep = async (milliseconds: number): Promise<void> => {
      sleeps.push(milliseconds);
      now += milliseconds;
    };

    const options = { stateFile: file, minimumIntervalMs: 0, now: () => now, sleep } as const;
    const first = new RedditRateBudget('client', options);
    const second = new RedditRateBudget('client', options);

    await first.acquire();
    await first.observe(new Response('', { status: 429 }));
    await second.acquire();

    expect(sleeps.length).toBe(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(10 * 60_000);
  });
  test('an owner override releases the shared local reserve immediately', async () => {
    const file = await stateFile();
    let now = 10_000;
    const options = {
      stateFile: file,
      minimumIntervalMs: 0,
      now: () => now,
      sleep: async (ms: number) => { now += ms; },
    } as const;
    const first = new RedditRateBudget('client', options);
    const second = new RedditRateBudget('client', options);
    await first.acquire();
    await first.observe(new Response('', {
      status: 200,
      headers: { 'x-ratelimit-remaining': '5', 'x-ratelimit-reset': '60' },
    }));
    expect((await second.forceUnblock()).ok).toBe(true);
    await first.acquire();
    await second.acquire();
    expect(now).toBe(10_000);
  });

  test('a force command cannot bypass an upstream 429 cooldown', async () => {
    const file = await stateFile();
    let now = 10_000;
    const options = {
      stateFile: file, minimumIntervalMs: 0, now: () => now,
      sleep: async (ms: number) => { now += ms; },
    } as const;
    const first = new RedditRateBudget('client', options);
    const second = new RedditRateBudget('client', options);
    await first.acquire();
    await first.observe(new Response('', { status: 429 }));
    const denied = await second.forceUnblock();
    expect(denied.ok).toBe(false);
    expect(denied.detail).toContain('429');
  });

  test('a waiting local soft block rechecks for override within one second', async () => {
    const file = await stateFile();
    let now = 10_000;
    let second: RedditRateBudget;
    let sleeps = 0;
    const options = {
      stateFile: file, minimumIntervalMs: 0, now: () => now,
      sleep: async (ms: number) => {
        now += ms;
        sleeps += 1;
        if (sleeps === 1) expect((await second.forceUnblock()).ok).toBe(true);
      },
    } as const;
    const first = new RedditRateBudget('client', options);
    second = new RedditRateBudget('client', options);
    await first.acquire();
    await first.observe(new Response('', {
      status: 200,
      headers: { 'x-ratelimit-remaining': '5', 'x-ratelimit-reset': '60' },
    }));
    await first.acquire();
    expect(sleeps).toBe(1);
    expect(now).toBe(11_000);
  });

});
