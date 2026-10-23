import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RedditAuthCfg } from '../src/env.ts';
import { ReputationStore } from '../src/reputation/store.ts';
import { RedditMutationClient } from '../src/reddit/mutate.ts';
import { RedditUserReachability } from '../src/reddit/userReachability.ts';
import { Store } from '../src/store/store.ts';
import { isMap } from '../src/types/json.ts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const auth: RedditAuthCfg = {
  clientId: 'test-client', clientSecret: 'test-secret',
  username: 'mae', password: 'unused', userAgent: 'mae-unit-test',
};

describe('persistent unreachable users', () => {
  test('a 403 closes all outstanding user effects and no other mutation retries the user', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mae-unreachable-'));
    roots.push(dir);
    const reputationPath = join(dir, 'reputation.pb');
    const unreachablePath = join(dir, 'unreachable.pb');
    const reputation = new ReputationStore(reputationPath);
    const rawStore = new Store(reputationPath, {
      schema: 1, users: {}, contributions: {}, notices: {}, discipline: {},
    });
    await rawStore.edit(() => ({
      schema: 1, users: {
        alice: {
          username: 'Alice', points: 5, tier: 1, status: 'ordinary',
          currentFlairTemplateId: null, desiredFlairTemplateId: 'desired',
          desiredFlairText: 'member', needsFlair: true,
        },
      },
      contributions: {
        t1_one: {
          fullname: 't1_one', author: 'Alice',
          removeRequired: true, removeApplied: false,
          banRequired: true, banApplied: false,
        },
      },
      notices: {
        n1: { key: 'n1', username: 'Alice', subject: 'Hello', body: 'Welcome', sent: false },
      },
      discipline: {
        alice: { redditMuted: false, muteUntil: 9999999999999 },
      },
    }));
    const reachability = new RedditUserReachability(unreachablePath, reputationPath);

    const requests: string[] = [];
    const fetcher = async (input: string | URL | Request): Promise<Response> => {
      const url = new URL(String(input));
      requests.push(url.pathname);
      if (url.pathname === '/api/v1/access_token') {
        return Response.json({ access_token: 'test', expires_in: 3600 });
      }
      if (url.pathname === '/r/catgirlcoin/api/selectflair') return new Response('', { status: 403 });
      return Response.json({ json: { errors: [] } });
    };
    const first = new RedditMutationClient(auth, { fetcher, reachability, maxAttempts: 1 });
    await first.setUserFlairTemplate('catgirlcoin', 'Alice', 'desired', null);
    expect((await reachability.get('alice'))?.status).toBe(403);
    expect((await reachability.get('ALICE'))?.operation).toBe('set-flair-template');

    const stored = await reputation.raw();
    if (!isMap(stored) || !isMap(stored['users']) || !isMap(stored['contributions'])
      || !isMap(stored['notices']) || !isMap(stored['discipline'])) {
      throw new Error('Expected reputation store maps');
    }
    const alice = stored['users']['alice'];
    const contribution = stored['contributions']['t1_one'];
    const notice = stored['notices']['n1'];
    const discipline = stored['discipline']['alice'];
    if (!isMap(alice) || !isMap(contribution) || !isMap(notice) || !isMap(discipline)) {
      throw new Error('Missing canonical records');
    }
    expect(alice['needsFlair']).toBe(false);
    expect(alice['status']).toBe('ordinary');
    expect(isMap(alice['unreachable'])).toBe(true);
    expect(alice['currentFlairTemplateId']).toBe(null);
    expect(alice['flairSkippedUnreachable']).toBe(true);
    expect(contribution['banApplied']).toBe(true);
    expect(contribution['banSkippedUnreachable']).toBe(true);
    expect(contribution['removeApplied']).toBe(true);
    expect(contribution['removeSkippedUnreachable']).toBe(true);
    expect(notice['sent']).toBe(true);
    expect(notice['skippedUnreachable']).toBe(true);
    expect(discipline['externalActionsSkippedUnreachable']).toBe(true);
    expect(await reputation.pendingEffects()).toMatchObject({
      flairs: [], removals: [], bans: [], notices: [], mutes: [],
    });

    const before = requests.length;
    await first.banUser('catgirlcoin', 'Alice', 'reason', 'note');
    await first.muteUser('nyaonearth', 'Alice', 'note');
    await first.unbanUser('catgirlcoin', 'Alice');
    await first.sendPrivateMessage('Alice', 'Subject', 'Body');
    const second = new RedditMutationClient(auth, {
      fetcher,
      reachability: new RedditUserReachability(unreachablePath, reputationPath),
    });
    await second.setUserFlairTemplate('nyaonearth', 'Alice', 'desired', null);
    expect(requests).toHaveLength(before);
  });

  test('unrelated users are still actionable after a different user is unreachable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mae-unreachable-other-'));
    roots.push(dir);
    const reachability = new RedditUserReachability(join(dir, 'unreachable.pb'), join(dir, 'reputation.pb'));
    await reachability.markUnreachable('Alice', 'ban', 'forbidden');
    expect(await reachability.isUnreachable('Alice')).toBe(true);
    expect(await reachability.isUnreachable('Bob')).toBe(false);
  });
});
