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
