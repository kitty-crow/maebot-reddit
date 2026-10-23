import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RedditAuthCfg } from '../src/env.ts';
import { ReputationStore } from '../src/reputation/store.ts';
import { reputationMuteEffects } from '../src/reputation/muteReconcile.ts';
import { RedditMutationClient } from '../src/reddit/mutate.ts';
import { RedditOperationDeferred, RedditUserReachability } from '../src/reddit/userReachability.ts';
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
  test('one 403 holds only the denied operation without quarantining or settling the whole user', async () => {
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
    await expect(first.setUserFlairTemplate('catgirlcoin', 'Alice', 'desired', null))
      .rejects.toMatchObject({ status: 403 });
    expect(await reachability.isUnreachable('alice')).toBe(false);
    expect(await reachability.operationHoldUntil('alice', 'set-flair-template', '/r/catgirlcoin/api/selectflair'))
      .toBeGreaterThan(Date.now());

    const stored = await reputation.raw();
    if (!isMap(stored) || !isMap(stored['users']) || !isMap(stored['contributions'])
      || !isMap(stored['notices']) || !isMap(stored['discipline'])) {
      throw new Error('Expected reputation store maps');
    }
    const alice = stored['users']['alice'];
    const contribution = stored['contributions']['t1_one'];
    const notice = stored['notices']['n1'];
    if (!isMap(alice) || !isMap(contribution) || !isMap(notice)) throw new Error('Missing records');

    expect(alice['unreachable']).toBeUndefined();
    expect(alice['needsFlair']).toBe(true);
    expect(alice['status']).toBe('ordinary');
    expect(contribution['banApplied']).toBe(false);
    expect(contribution['removeApplied']).toBe(false);
    expect(notice['sent']).toBe(false);

    const before = requests.length;
    const second = new RedditMutationClient(auth, {
      fetcher,
      reachability: new RedditUserReachability(unreachablePath, reputationPath),
      maxAttempts: 1,
    });
    await expect(second.setUserFlairTemplate('catgirlcoin', 'Alice', 'desired', null))
      .rejects.toBeInstanceOf(RedditOperationDeferred);
    expect(requests).toHaveLength(before);

    // Different moderation actions and other communities remain reachable.
    await second.banUser('catgirlcoin', 'Alice', 'reason', 'note');
    await second.muteUser('nyaonearth', 'Alice', 'note');
    expect(requests.length).toBeGreaterThan(before);

    // Only independent confirmation permits closing all outstanding work.
    await reachability.markUnreachable('Alice', 'account-verification', 'independent account lookup confirms inaccessible');
    expect(await reachability.isUnreachable('alice')).toBe(true);
    const settled = await reputation.raw();
    if (!isMap(settled) || !isMap(settled['users']) || !isMap(settled['contributions'])
      || !isMap(settled['notices'])) throw new Error('Missing settled records');
    const settledUser = settled['users']['alice'];
    const settledEffect = settled['contributions']['t1_one'];
    const settledNotice = settled['notices']['n1'];
    if (!isMap(settledUser) || !isMap(settledEffect) || !isMap(settledNotice)) {
      throw new Error('Missing settled user/effect records');
    }
    expect(settledUser['needsFlair']).toBe(false);
    expect(settledUser['flairSkippedUnreachable']).toBe(true);
    expect(settledUser['currentFlairTemplateId']).toBe(null);
    expect(settledEffect['banSkippedUnreachable']).toBe(true);
    expect(settledEffect['removeSkippedUnreachable']).toBe(true);
    expect(settledNotice['skippedUnreachable']).toBe(true);
    expect(await reputation.pendingEffects()).toMatchObject({
      flairs: [], removals: [], bans: [], notices: [], mutes: [],
    });
    expect(reputationMuteEffects(await reputation.raw())).toEqual([]);

    const afterConfirmation = requests.length;
    await second.setUserFlairTemplate('nyaonearth', 'Alice', 'desired', null);
    await second.sendPrivateMessage('Alice', 'Subject', 'Body');
    expect(requests).toHaveLength(afterConfirmation);
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
