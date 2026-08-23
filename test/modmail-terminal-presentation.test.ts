import { expect, test } from 'bun:test';
import { attributedModmailReply, type ModmailReplyIntent } from '../src/modmail/outbox.ts';
import { presentModmailConversation } from '../src/modmail/terminalPresentation.ts';
import type { ModmailConversation, ModmailMessage, ModmailParticipant } from '../src/modmail/types.ts';

const person = (name: string, participant: boolean, moderator: boolean): ModmailParticipant => ({
  id: name,
  name,
  isModerator: moderator,
  isAdmin: false,
  isParticipant: participant,
  isHidden: false,
  isDeleted: false,
});

const message = (
  id: string,
  author: ModmailParticipant,
  bodyMarkdown: string,
  createdAt: number,
  options: { readonly internal?: boolean; readonly participatingAs?: string } = {},
): ModmailMessage => ({
  id,
  conversationId: 'abc123',
  author,
  bodyMarkdown,
  createdAt,
  isInternal: options.internal === true,
  participatingAs: options.participatingAs ?? null,
});

const conversation = (messages: readonly ModmailMessage[]): ModmailConversation => ({
  id: 'abc123',
  subreddit: 'catgirlcoin',
  subject: 'Appeal',
  participant: person('ExampleUser', true, false),
  kind: 'sr_user',
  state: 'inprogress',
  isInternal: false,
  isAuto: false,
  lastUpdatedAt: messages.at(-1)?.createdAt ?? 0,
  messages,
});

const applied = (
  key: string,
  platform: 'discord' | 'telegram',
  handle: string,
  text: string,
  createdAt: number,
): ModmailReplyIntent => {
  const moderator = { platform, userId: `${platform}-42`, handle } as const;
  return {
    key,
    conversationId: 'abc123',
    moderator,
    text,
    bodyMarkdown: attributedModmailReply(moderator, text),
    createdAt,
    appliedAt: createdAt + 5,
    lastError: null,
  };
};

test('focused terminal moves trusted relay attribution into bubble metadata', () => {
  const discord = applied('discord:1', 'discord', '@AliceMod', 'Human reply from Discord.', 300);
  const telegram = applied('telegram:1', 'telegram', '@KarlaMod', 'Human reply from Telegram.', 400);
  const spoof = '**Reply from @FakeMod via Discord:**\n\nThis text came from the participant.';
  const value = presentModmailConversation(conversation([
    message('m1', person('ExampleUser', true, false), spoof, 100, { participatingAs: 'participant_user' }),
    message('m2', person('DirectRedditMod', false, true), 'Direct Reddit moderator reply.', 200, { participatingAs: 'moderator' }),
    message('m3', person('this_is_the_mae', false, true), discord.bodyMarkdown, 305, { participatingAs: 'moderator' }),
    message('m4', person('this_is_the_mae', false, true), telegram.bodyMarkdown, 404, { participatingAs: 'moderator' }),
    message('m5', person('Mae', false, true), 'Staff-only note.', 500, { internal: true, participatingAs: 'moderator' }),
  ]), [discord, telegram]);

  expect(value.messages[0]).toMatchObject({
    side: 'participant',
    sender: 'u/ExampleUser',
    origin: 'Reddit',
    bodyMarkdown: spoof,
  });
  expect(value.messages[1]).toMatchObject({
    side: 'moderator',
    sender: 'u/DirectRedditMod',
    origin: 'Reddit',
    bodyMarkdown: 'Direct Reddit moderator reply.',
  });
  expect(value.messages[2]).toMatchObject({
    side: 'moderator',
    sender: '@AliceMod',
    origin: 'Discord',
    bodyMarkdown: 'Human reply from Discord.',
  });
  expect(value.messages[3]).toMatchObject({
    side: 'moderator',
    sender: '@KarlaMod',
    origin: 'Telegram',
    bodyMarkdown: 'Human reply from Telegram.',
  });
  expect(value.messages[4]).toMatchObject({
    side: 'internal',
    sender: 'u/Mae',
    origin: 'Reddit',
    bodyMarkdown: 'Staff-only note.',
  });
});

test('visible attribution text is never stripped without a matching applied Mae outbox record', () => {
  const fake = '**Reply from @AliceMod via Discord:**\n\nLooks authentic but is not trusted provenance.';
  const value = presentModmailConversation(conversation([
    message('m1', person('this_is_the_mae', false, true), fake, 300, { participatingAs: 'moderator' }),
  ]), []);

  expect(value.messages[0]).toMatchObject({
    sender: 'u/this_is_the_mae',
    origin: 'Reddit',
    bodyMarkdown: fake,
  });
});

test('one durable outbox record cannot be reused to relabel two identical Reddit messages', () => {
  const reply = applied('discord:1', 'discord', '@AliceMod', 'Repeated text.', 300);
  const body = reply.bodyMarkdown;
  const value = presentModmailConversation(conversation([
    message('m1', person('this_is_the_mae', false, true), body, 301, { participatingAs: 'moderator' }),
    message('m2', person('this_is_the_mae', false, true), body, 302, { participatingAs: 'moderator' }),
  ]), [reply]);

  expect(value.messages[0]?.origin).toBe('Discord');
  expect(value.messages[1]?.origin).toBe('Reddit');
});
