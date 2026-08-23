import { modmailReplyAttribution, type ModmailReplyIntent } from './outbox.ts';
import type { ModmailConversation, ModmailMessage } from './types.ts';

export type TerminalMessageSide = 'participant' | 'moderator' | 'internal';
export type TerminalMessageOrigin = 'Reddit' | 'Discord' | 'Telegram';

export type TerminalMessageView = {
  readonly id: string;
  readonly bodyMarkdown: string;
  readonly createdAt: number;
  readonly side: TerminalMessageSide;
  readonly sender: string;
  readonly origin: TerminalMessageOrigin;
};

export type TerminalConversationView = {
  readonly participant: string | null;
  readonly subreddit: string;
  readonly subject: string;
  readonly state: ModmailConversation['state'];
  readonly messages: readonly TerminalMessageView[];
};

const redditHandle = (name: string | null): string => name === null ? '[deleted]' : `u/${name}`;

const sideFor = (conversation: ModmailConversation, message: ModmailMessage): TerminalMessageSide => {
  if (message.isInternal) return 'internal';
  if (
    message.author?.isModerator === true
    || message.author?.isAdmin === true
    || message.participatingAs === 'moderator'
  ) return 'moderator';
  if (
    message.author?.isParticipant === true
    || message.participatingAs === 'participant_user'
  ) return 'participant';

  const author = message.author?.name?.toLowerCase() ?? null;
  const participant = conversation.participant?.name?.toLowerCase() ?? null;
  if (author !== null && participant !== null && author === participant) return 'participant';

  // Reddit can emit system/deleted-author entries that are neither participant
  // nor moderator speech. Keep those centred instead of falsely attributing them.
  return 'internal';
};

const appliedMatch = (
  message: ModmailMessage,
  replies: readonly ModmailReplyIntent[],
  used: Set<string>,
): ModmailReplyIntent | null => {
  const candidates = replies
    .filter(reply =>
      !used.has(reply.key)
      && reply.appliedAt !== null
      && reply.bodyMarkdown === message.bodyMarkdown
      && message.createdAt >= Math.max(0, reply.createdAt - 60)
      && message.createdAt <= reply.createdAt + 300)
    .sort((a, b) => {
      const aDistance = Math.abs(message.createdAt - a.createdAt);
      const bDistance = Math.abs(message.createdAt - b.createdAt);
      return aDistance - bDistance || a.key.localeCompare(b.key);
    });
  const selected = candidates[0] ?? null;
  if (selected !== null) used.add(selected.key);
  return selected;
};

const relayView = (reply: ModmailReplyIntent, message: ModmailMessage): TerminalMessageView => {
  const prefix = `${modmailReplyAttribution(reply.moderator)}\n\n`;
  const body = message.bodyMarkdown.startsWith(prefix)
    ? message.bodyMarkdown.slice(prefix.length)
    : reply.text;
  return {
    id: message.id,
    bodyMarkdown: body,
    createdAt: message.createdAt,
    side: 'moderator',
    sender: reply.moderator.handle,
    origin: reply.moderator.platform === 'discord' ? 'Discord' : 'Telegram',
  };
};

export const presentModmailConversation = (
  conversation: ModmailConversation,
  appliedReplies: readonly ModmailReplyIntent[],
): TerminalConversationView => {
  const used = new Set<string>();
  const messages = conversation.messages.map(message => {
    const side = sideFor(conversation, message);
    if (side === 'moderator') {
      const relay = appliedMatch(message, appliedReplies, used);
      if (relay !== null) return relayView(relay, message);
    }
    return {
      id: message.id,
      bodyMarkdown: message.bodyMarkdown,
      createdAt: message.createdAt,
      side,
      sender: redditHandle(message.author?.name ?? null),
      origin: 'Reddit' as const,
    };
  });
  return {
    participant: conversation.participant?.name ?? null,
    subreddit: conversation.subreddit,
    subject: conversation.subject,
    state: conversation.state,
    messages,
  };
};
