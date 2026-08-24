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
    expect(sleeps.length).toBe(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(60_000);
  });

  test('paces independent instances through one shared one-second request slot', async () => {
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

    expect(sleeps).toEqual([1_000]);
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
});
