import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModmailStore } from '../src/modmail/store.ts';
import type { ModmailConversation, ModmailMessage } from '../src/modmail/types.ts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const conversation = (
  id: string,
  subreddit: string,
  messages: readonly { readonly id: string; readonly body: string; readonly at: number }[],
): ModmailConversation => {
  const decoded: ModmailMessage[] = messages.map(item => ({
    id: item.id,
    conversationId: id,
    author: {
      id: 'user-id',
      name: 'SomeUser',
      isModerator: false,
      isAdmin: false,
      isParticipant: true,
      isHidden: false,
      isDeleted: false,
    },
    bodyMarkdown: item.body,
    createdAt: item.at,
    isInternal: false,
    participatingAs: 'participant_user',
  }));
  return {
    id,
    subreddit,
    subject: 'Appeal',
    participant: {
      id: 'user-id',
      name: 'SomeUser',
      isModerator: false,
      isAdmin: false,
      isParticipant: true,
      isHidden: false,
      isDeleted: false,
    },
    kind: 'sr_user',
    state: 'inprogress',
    isInternal: false,
    isAuto: false,
    lastUpdatedAt: decoded.at(-1)?.createdAt ?? 0,
    messages: decoded,
  };
};

describe('per-community modmail activation', () => {
  test('adding NyaOnEarth seeds its existing history but relays later messages normally', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mae-modmail-community-'));
    roots.push(root);
    const store = new ModmailStore(join(root, 'modmail.pb'));

    const sourceInitial = conversation('source', 'catgirlcoin', [{ id: 's1', body: 'old source', at: 100 }]);
    await store.sync([sourceInitial], 100, ['catgirlcoin']);

    const sourceLater = conversation('source', 'catgirlcoin', [
      { id: 's1', body: 'old source', at: 100 },
      { id: 's2', body: 'new source', at: 200 },
    ]);
    expect((await store.sync([sourceLater], 200, ['catgirlcoin'])).map(event => event.messageId)).toEqual(['s2']);

    const targetHistoric = conversation('target', 'nyaonearth', [
      { id: 'n1', body: 'historic target', at: 120 },
      { id: 'n2', body: 'also historic target', at: 150 },
    ]);
    expect(await store.sync(
      [sourceLater, targetHistoric],
      210,
      ['catgirlcoin', 'nyaonearth'],
    )).toEqual([]);

    const targetLater = conversation('target', 'nyaonearth', [
      { id: 'n1', body: 'historic target', at: 120 },
      { id: 'n2', body: 'also historic target', at: 150 },
      { id: 'n3', body: 'new target', at: 220 },
    ]);
    expect((await store.sync(
      [sourceLater, targetLater],
      220,
      ['catgirlcoin', 'nyaonearth'],
    )).map(event => `${event.subreddit}:${event.messageId}`)).toEqual(['nyaonearth:n3']);
  });
});
