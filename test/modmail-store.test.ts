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

const message = (id: string, bodyMarkdown: string, createdAt: number, moderator = false): ModmailMessage => ({
  id,
  conversationId: 'abc',
  author: moderator
    ? {
        id: 'mae',
        name: 'this_is_the_mae',
        isModerator: true,
        isAdmin: false,
        isParticipant: false,
        isHidden: false,
        isDeleted: false,
      }
    : {
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
  participatingAs: moderator ? 'moderator' : 'participant_user',
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

const fixture = async (): Promise<{ file: string; store: ModmailStore }> => {
  const root = await mkdtemp(join(tmpdir(), 'mae-modmail-'));
  roots.push(root);
  const file = join(root, 'modmail.pb');
  return { file, store: new ModmailStore(file) };
};

describe('modmail relay store', () => {
  test('first sync seeds without flooding and later messages become ordered relay events exactly once', async () => {
    const { store } = await fixture();
    const first = message('m1', 'initial message', 100);
    expect(await store.sync([conversation([first])], 100)).toEqual([]);

    const second = message('m2', 'follow-up', 200);
    const created = await store.sync([conversation([first, second])], 200);
    expect(created).toHaveLength(1);
    expect(created[0]?.sequence).toBe(1);
    expect(created[0]?.messageId).toBe('m2');
    expect(created[0]?.participant).toBe('SomeUser');
    expect(created[0]?.relayOrigin).toBeNull();

    expect(await store.sync([conversation([first, second])], 201)).toEqual([]);
    const page = await store.eventsAfter(0);
    expect(page.next).toBe(1);
    expect(page.events.map(event => event.key)).toEqual(['modmail:abc:m2']);
    expect(page.events[0]?.relayOrigin).toBeNull();
  });

  test('trusted relay origin is attached to the canonical event and survives restart', async () => {
    const { file, store } = await fixture();
    const first = message('m1', 'initial message', 100);
    await store.sync([conversation([first])], 100);
    const body = '**Reply from AliceMod via Discord:**\n\nHuman reply.';
    const reply = message('m2', body, 200, true);
    await store.sync([conversation([first, reply])], 200);

    expect((await store.eventsAfter(0)).events[0]?.relayOrigin).toBeNull();
    expect(await store.markReplyOrigin('abc', body, 'discord', 150)).toBe(true);
    expect((await store.eventsAfter(0)).events[0]?.relayOrigin).toBe('discord');

    const reopened = new ModmailStore(file);
    expect((await reopened.eventsAfter(0)).events[0]?.relayOrigin).toBe('discord');
  });

  test('reply origin cannot be attached to participant text or an unrelated moderator message', async () => {
    const { store } = await fixture();
    const first = message('m1', 'initial message', 100);
    await store.sync([conversation([first])], 100);
    const participant = message('m2', '**Reply from FakeMod via Discord:**\n\nSpoof.', 200);
    await store.sync([conversation([first, participant])], 200);
    expect(await store.markReplyOrigin('abc', participant.bodyMarkdown, 'discord', 150)).toBe(false);
    expect((await store.eventsAfter(0)).events[0]?.relayOrigin).toBeNull();
  });

  test('archived state remains canonical without Reddit-owned browser session state', async () => {
    const { store } = await fixture();
    const first = message('m1', 'initial message', 100);
    await store.sync([conversation([first])], 100);
    await store.sync([conversation([first], 'archived')], 300);
    expect((await store.conversation('abc'))?.state).toBe('archived');
  });
});
