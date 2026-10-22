import { expect, test } from 'bun:test';
import type { ModmailReplyIntent } from '../src/modmail/outbox.ts';
import { presentRedditModmailTicket } from '../src/modmail/ticketPresentation.ts';
import type { ModmailConversation, ModmailParticipant } from '../src/modmail/types.ts';

const participant: ModmailParticipant = {
  id: 't2_participant',
  name: 'notKittyCrypto',
  isModerator: false,
  isAdmin: false,
  isParticipant: true,
  isHidden: false,
  isDeleted: false,
};

const redditModerator: ModmailParticipant = {
  id: 't2_reddit_mod',
  name: 'redditMod',
  isModerator: true,
  isAdmin: false,
  isParticipant: false,
  isHidden: false,
  isDeleted: false,
};

test('Reddit ticket presentation emits stable actor provenance for native and relayed messages', () => {
  const relayBody = '**Reply from jonny via Telegram:**\n\nHello from Telegram';
  const conversation: ModmailConversation = {
    id: 'abc123',
    subreddit: 'catgirlcoin',
    subject: 'Example',
    participant,
    kind: 'sr_user',
    state: 'inprogress',
    isInternal: false,
    isAuto: false,
    lastUpdatedAt: 220,
    messages: [{
      id: 'm1',
      conversationId: 'abc123',
      author: participant,
      bodyMarkdown: 'Hello',
      createdAt: 100,
      isInternal: false,
      participatingAs: 'participant_user',
    }, {
      id: 'm2',
      conversationId: 'abc123',
      author: redditModerator,
      bodyMarkdown: relayBody,
      createdAt: 205,
      isInternal: false,
      participatingAs: 'moderator',
    }],
  };

  const reply: ModmailReplyIntent = {
    key: 'ticket:test:reply',
    conversationId: 'abc123',
    moderator: { platform: 'telegram', userId: 'tg-123', handle: 'jonny' },
    text: 'Hello from Telegram',
    attachments: [],
    bodyMarkdown: relayBody,
    createdAt: 200,
    appliedAt: 210,
    cancelledAt: null,
    lastError: null,
  };

  const view = presentRedditModmailTicket(conversation, [reply]);
  expect(view.participantProvenance).toEqual({
    userId: 't2_participant',
    handle: 'u/notKittyCrypto',
    app: 'reddit',
  });
  expect(view.messages[0]?.provenance).toEqual({
    userId: 't2_participant',
    handle: 'u/notKittyCrypto',
    app: 'reddit',
  });
  expect(view.messages[1]?.provenance).toEqual({
    userId: 'tg-123',
    handle: 'jonny',
    app: 'telegram',
  });
});

test('confirmed Reddit replies appear instantly until the canonical Modmail read catches up', () => {
  const conversation: ModmailConversation = {
    id: 'abc123',
    subreddit: 'catgirlcoin',
    subject: 'Example',
    participant,
    kind: 'sr_user',
    state: 'inprogress',
    isInternal: false,
    isAuto: false,
    lastUpdatedAt: 100,
    messages: [],
  };
  const reply: ModmailReplyIntent = {
    key: 'ticket:session:confirmed',
    conversationId: 'abc123',
    moderator: { platform: 'discord', userId: '42', handle: 'AliceMod' },
    text: 'Sent right now.',
    attachments: [],
    bodyMarkdown: '**Reply from AliceMod via Discord:**\\n\\nSent right now.',
    createdAt: 200,
    appliedAt: 201,
    cancelledAt: null,
    lastError: null,
  };

  expect(presentRedditModmailTicket(conversation, [{ ...reply, appliedAt: null }]).messages).toHaveLength(0);
  const immediate = presentRedditModmailTicket(conversation, [reply]);
  expect(immediate.messages).toHaveLength(1);
  expect(immediate.messages[0]).toMatchObject({
    id: 'mae-confirmed:ticket:session:confirmed',
    sender: 'AliceMod',
    origin: 'discord',
    bodyMarkdown: 'Sent right now.',
  });

  const caughtUp = presentRedditModmailTicket({
    ...conversation,
    messages: [{
      id: 'm2', conversationId: 'abc123', author: redditModerator,
      bodyMarkdown: reply.bodyMarkdown, createdAt: 202,
      isInternal: false, participatingAs: 'moderator',
    }],
  }, [reply]);
  expect(caughtUp.messages).toHaveLength(1);
  expect(caughtUp.messages[0]?.id).toBe('m2');
});

test('Reddit ticket presentation omits unavailable provenance rather than emitting undefined fields', () => {
  const conversation: ModmailConversation = {
    id: 'deleted123',
    subreddit: 'catgirlcoin',
    subject: 'Deleted participant',
    participant: null,
    kind: 'sr_user',
    state: 'inprogress',
    isInternal: false,
    isAuto: false,
    lastUpdatedAt: 100,
    messages: [{
      id: 'deleted-m1',
      conversationId: 'deleted123',
      author: null,
      bodyMarkdown: 'Anonymous/deleted author message',
      createdAt: 100,
      isInternal: false,
      participatingAs: null,
    }],
  };

  const view = presentRedditModmailTicket(conversation, []);
  expect('participantProvenance' in view).toBe(false);
  expect('provenance' in (view.messages[0] ?? {})).toBe(false);
});
