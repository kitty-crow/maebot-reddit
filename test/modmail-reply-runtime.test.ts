import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModmailReplyOutbox, attributedModmailReply } from '../src/modmail/outbox.ts';
import { ModmailRuntime, type ModmailReader, type ModmailWriter } from '../src/modmail/runtime.ts';
import { ModmailStore } from '../src/modmail/store.ts';
import type { ModmailConversation, ModmailMessage } from '../src/modmail/types.ts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const participant = {
  id: 'u1',
  name: 'SomeUser',
  isModerator: false,
  isAdmin: false,
  isParticipant: true,
  isHidden: false,
  isDeleted: false,
} as const;

const moderator = {
  id: 'mae',
  name: 'this_is_the_mae',
  isModerator: true,
  isAdmin: false,
  isParticipant: false,
  isHidden: false,
  isDeleted: false,
} as const;

const baseMessage: ModmailMessage = {
  id: 'm1',
  conversationId: 'abc123',
  author: participant,
  bodyMarkdown: 'Please review this.',
  createdAt: 100,
  isInternal: false,
  participatingAs: 'participant_user',
};

const conversation = (messages: readonly ModmailMessage[], updated = 100): ModmailConversation => ({
  id: 'abc123',
  subreddit: 'catgirlcoin',
  subject: 'Appeal',
  participant,
  kind: 'sr_user',
  state: 'inprogress',
  isInternal: false,
  isAuto: false,
  lastUpdatedAt: updated,
  messages,
});

class Reader implements ModmailReader {
  public current = conversation([baseMessage]);

  public async modmailConversations(): Promise<{ readonly conversations: readonly ModmailConversation[]; readonly after: string | null }> {
    return { conversations: [this.current], after: null };
  }

  public async modmailConversation(): Promise<ModmailConversation> {
    return this.current;
  }
}

class Writer implements ModmailWriter {
  public calls = 0;

  public constructor(private readonly reader: Reader) {}

  public async replyModmail(_conversationId: string, body: string): Promise<void> {
    this.calls += 1;
    const message: ModmailMessage = {
      id: `m${this.calls + 1}`,
      conversationId: 'abc123',
      author: moderator,
      bodyMarkdown: body,
      createdAt: 200 + this.calls,
      isInternal: false,
      participatingAs: 'moderator',
    };
    this.reader.current = conversation([...this.reader.current.messages, message], message.createdAt);
  }
}

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'mae-modmail-reply-runtime-'));
  roots.push(root);
  const relay = new ModmailStore(join(root, 'modmail.pb'));
  const outbox = new ModmailReplyOutbox(join(root, 'replies.pb'));
  const reader = new Reader();
  const writer = new Writer(reader);
  await relay.sync([reader.current], 100, ['catgirlcoin']);
  const runtime = new ModmailRuntime(
    'catgirlcoin',
    reader,
    writer,
    relay,
    outbox,
  );
  return { relay, outbox, reader, writer, runtime };
};

describe('cross-platform Reddit Modmail reply runtime', () => {
  test('posts one attributed Discord reply and relays the canonical Reddit message to other consumers', async () => {
    const { relay, outbox, writer, runtime } = await fixture();
    await outbox.queue({
      key: 'discord:123456',
      conversationId: 'abc123',
      moderator: { platform: 'discord', userId: '42', handle: 'AliceMod' },
      text: 'I am reviewing your appeal.',
      createdAt: 150,
    });

    const result = await runtime.tick();
    expect(result.repliesApplied).toBe(1);
    expect(result.failed).toBe(0);
    expect(writer.calls).toBe(1);
    expect(await outbox.pending()).toEqual([]);

    const page = await relay.eventsAfter(0);
    expect(page.events).toHaveLength(1);
    expect(page.events[0]).toMatchObject({
      conversationId: 'abc123',
      author: 'this_is_the_mae',
      participatingAs: 'moderator',
      relayOrigin: 'discord',
      bodyMarkdown: attributedModmailReply(
        { platform: 'discord', userId: '42', handle: 'AliceMod' },
        'I am reviewing your appeal.',
      ),
    });
  });

  test('after a crash following Reddit success, retry reconciles the existing canonical reply instead of posting twice', async () => {
    const { relay, outbox, reader, writer, runtime } = await fixture();
    const identity = { platform: 'discord' as const, userId: '42', handle: 'AliceMod' };
    const body = attributedModmailReply(identity, 'Already reached Reddit before the crash.');
    await outbox.queue({
      key: 'discord:crash123',
      conversationId: 'abc123',
      moderator: identity,
      text: 'Already reached Reddit before the crash.',
      createdAt: 150,
    });

    reader.current = conversation([
      baseMessage,
      {
        id: 'm2',
        conversationId: 'abc123',
        author: moderator,
        bodyMarkdown: body,
        createdAt: 151,
        isInternal: false,
        participatingAs: 'moderator',
      },
    ], 151);

    const result = await runtime.tick();
    expect(result.repliesApplied).toBe(1);
    expect(result.failed).toBe(0);
    expect(writer.calls).toBe(0);
    expect(await outbox.pending()).toEqual([]);

    const page = await relay.eventsAfter(0);
    expect(page.events).toHaveLength(1);
    expect(page.events[0]?.bodyMarkdown).toBe(body);
    expect(page.events[0]?.relayOrigin).toBe('discord');

    const second = await runtime.tick();
    expect(second.repliesApplied).toBe(0);
    expect(writer.calls).toBe(0);
    expect((await relay.eventsAfter(0)).events).toHaveLength(1);
  });
});
