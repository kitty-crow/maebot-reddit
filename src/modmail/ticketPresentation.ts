import type { ModmailReplyIntent } from './outbox.ts';
import type { ModmailConversation, ModmailMessage, ModmailParticipant } from './types.ts';

export type RedditTicketMessageSide = 'participant' | 'moderator' | 'internal';
export type RedditTicketMessageOrigin = 'reddit' | 'discord' | 'telegram';

export type RedditTicketActorProvenance = {
  readonly userId: string;
  readonly handle: string;
  readonly app: string;
};

export type RedditTicketAttachment = {
  readonly id: string;
  readonly name: string;
  readonly kind: 'image' | 'video' | 'file';
  readonly url: string;
  readonly mimeType: string;
  readonly size: number;
  readonly expiresAt: number;
};

export type RedditTicketMessageView = {
  readonly id: string;
  readonly bodyMarkdown: string;
  readonly createdAt: number;
  readonly side: RedditTicketMessageSide;
  readonly sender: string;
  readonly origin: RedditTicketMessageOrigin;
  readonly provenance?: RedditTicketActorProvenance;
  /** Opaque stable Mae Nya identity when this message came from a Mae relay. */
  readonly authorNyaId?: string;
  readonly attachments: readonly RedditTicketAttachment[];
};

export type RedditTicketView = {
  readonly participant: string | null;
  readonly participantProvenance?: RedditTicketActorProvenance;
  readonly subreddit: string;
  readonly subject: string;
  readonly state: ModmailConversation['state'];
  readonly messages: readonly RedditTicketMessageView[];
};

const redditHandle = (name: string | null): string => name === null ? '[deleted]' : `u/${name}`;

const redditProvenance = (actor: ModmailParticipant | null): RedditTicketActorProvenance | undefined => {
  if (actor?.id === null || actor?.id === undefined || actor.name === null) return undefined;
  return {
    userId: actor.id,
    handle: redditHandle(actor.name),
    app: 'reddit',
  };
};

const sideFor = (conversation: ModmailConversation, message: ModmailMessage): RedditTicketMessageSide => {
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

const relayView = (reply: ModmailReplyIntent, message: ModmailMessage): RedditTicketMessageView => ({
  id: message.id,
  bodyMarkdown: reply.text,
  createdAt: message.createdAt,
  side: 'moderator',
  sender: reply.moderator.handle,
  origin: reply.moderator.platform,
  provenance: {
    userId: reply.moderator.userId,
    handle: reply.moderator.handle,
    app: reply.moderator.platform,
  },
  ...(reply.authorNyaId === undefined ? {} : { authorNyaId: reply.authorNyaId }),
  attachments: reply.attachments.map(attachment => ({
    id: attachment.id,
    name: attachment.name,
    kind: attachment.kind,
    url: attachment.url,
    mimeType: attachment.mimeType,
    size: attachment.size,
    expiresAt: attachment.expiresAt,
  })),
});

export const presentRedditModmailTicket = (
  conversation: ModmailConversation,
  appliedReplies: readonly ModmailReplyIntent[],
): RedditTicketView => {
  const used = new Set<string>();
  const messages: RedditTicketMessageView[] = conversation.messages.map(message => {
    const side = sideFor(conversation, message);
    if (side === 'moderator') {
      const relay = appliedMatch(message, appliedReplies, used);
      if (relay !== null) return relayView(relay, message);
    }

    const actor = redditProvenance(message.author);
    return {
      id: message.id,
      bodyMarkdown: message.bodyMarkdown,
      createdAt: message.createdAt,
      side,
      sender: redditHandle(message.author?.name ?? null),
      origin: 'reddit',
      ...(actor === undefined ? {} : { provenance: actor }),
      attachments: [],
    };
  });

  const participantProvenance = redditProvenance(conversation.participant);
  return {
    participant: conversation.participant?.name ?? null,
    ...(participantProvenance === undefined ? {} : { participantProvenance }),
    subreddit: conversation.subreddit,
    subject: conversation.subject,
    state: conversation.state,
    messages,
  };
};
