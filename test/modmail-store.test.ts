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

const message = (id: string, bodyMarkdown: string, createdAt: number): ModmailMessage => ({
  id,
  conversationId: 'abc',
  author: {
    id: 'u1',
    name: 'SomeUser',
    isModerator: false,
    isAdmin: false,
    isParticipant: true,
    isHidden: false,
    isDeleted: false,
  },
  bodyMarkdown,
  createdAt,
  isInternal: false,
  participatingAs: 'participant_user',
});

const conversation = (
  messages: readonly ModmailMessage[],
  state: ModmailConversation['state'] = 'inprogress',
): ModmailConversation => ({
  id: 'abc',
  subreddit: 'catgirlcoin',
  subject: 'Appeal',
  participant: {
    id: 'u1',
    name: 'SomeUser',
    isModerator: false,
    isAdmin: false,
    isParticipant: true,
    isHidden: false,
    isDeleted: false,
  },
  kind: 'sr_user',
  state,
  isInternal: false,
  isAuto: false,
  lastUpdatedAt: messages.at(-1)?.createdAt ?? 0,
  messages,
});

const fixture = async (): Promise<ModmailStore> => {
  const root = await mkdtemp(join(tmpdir(), 'mae-modmail-'));
  roots.push(root);
  return new ModmailStore(join(root, 'modmail.pb'));
};

describe('modmail relay store', () => {
  test('first sync seeds without flooding and later messages become ordered relay events exactly once', async () => {
    const store = await fixture();
    const first = message('m1', 'initial message', 100);
    expect(await store.sync([conversation([first])], 100)).toEqual([]);

    const second = message('m2', 'follow-up', 200);
    const created = await store.sync([conversation([first, second])], 200);
    expect(created).toHaveLength(1);
    expect(created[0]?.sequence).toBe(1);
    expect(created[0]?.messageId).toBe('m2');
    expect(created[0]?.participant).toBe('SomeUser');

    expect(await store.sync([conversation([first, second])], 201)).toEqual([]);
    const page = await store.eventsAfter(0);
    expect(page.next).toBe(1);
    expect(page.events.map(event => event.key)).toEqual(['modmail:abc:m2']);
  });

  test('terminal session is scoped to one conversation and retired when Reddit archives it', async () => {
    const store = await fixture();
    const first = message('m1', 'initial message', 100);
    await store.sync([conversation([first])], 100);
    const session = await store.createTerminalSession('abc', {
      platform: 'telegram',
      userId: '42',
      handle: '@alice',
    }, 3600, 200);

    expect((await store.terminalSession(session.token, 201))?.conversationId).toBe('abc');
    await store.sync([conversation([first], 'archived')], 300);
    expect(await store.terminalSession(session.token, 301)).toBeNull();
  });
});
