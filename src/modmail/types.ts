export type ModmailConversationState =
  | 'new'
  | 'inprogress'
  | 'archived'
  | 'appeals'
  | 'join_requests'
  | 'filtered'
  | 'unknown';

export type ModmailConversationKind = 'sr_user' | 'sr_sr' | 'internal' | 'unknown';

export type ModmailParticipant = {
  readonly id: string | null;
  readonly name: string | null;
  readonly isModerator: boolean;
  readonly isAdmin: boolean;
  readonly isParticipant: boolean;
  readonly isHidden: boolean;
  readonly isDeleted: boolean;
};

export type ModmailRelayPlatform = 'discord' | 'telegram' | 'reddit';

export type ModmailModeratorIdentity = {
  readonly platform: Exclude<ModmailRelayPlatform, 'reddit'>;
  readonly userId: string;
  readonly handle: string;
};

export type ModmailMessage = {
  readonly id: string;
  readonly conversationId: string;
  readonly author: ModmailParticipant | null;
  readonly bodyMarkdown: string;
  readonly createdAt: number;
  readonly isInternal: boolean;
  readonly participatingAs: string | null;
  readonly relayModerator?: ModmailModeratorIdentity | null;
};

export type ModmailConversation = {
  readonly id: string;
  readonly subreddit: string;
  readonly subject: string;
  readonly participant: ModmailParticipant | null;
  readonly kind: ModmailConversationKind;
  readonly state: ModmailConversationState;
  readonly isInternal: boolean;
  readonly isAuto: boolean;
  readonly lastUpdatedAt: number;
  readonly messages: readonly ModmailMessage[];
};

export type ModmailConversationPage = {
  readonly conversations: readonly ModmailConversation[];
  readonly after: string | null;
};

export type ModmailTerminalSession = {
  readonly token: string;
  readonly conversationId: string;
  readonly moderator: ModmailModeratorIdentity;
  readonly createdAt: number;
  readonly expiresAt: number;
};
