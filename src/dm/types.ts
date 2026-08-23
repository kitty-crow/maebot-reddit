export type RedditDirectMessage = {
  readonly id: string;
  readonly fullname: string;
  readonly author: string | null;
  readonly destination: string | null;
  readonly subject: string;
  readonly body: string;
  readonly createdUtc: number;
  readonly parentFullname: string | null;
  readonly firstMessageFullname: string | null;
  readonly isNew: boolean;
  readonly wasComment: boolean;
};

export type RedditDirectMessagePage = {
  readonly messages: readonly RedditDirectMessage[];
  readonly after: string | null;
};

export type DmConversationState = {
  readonly username: string;
  readonly moderationConversationId: string | null;
  readonly responseConversationId: string | null;
};

export type DmDeliveryState = 'seeded' | 'pending' | 'attempted' | 'sent' | 'no-reply';

export type DmMessageState = {
  readonly message: RedditDirectMessage;
  readonly classificationApplied: boolean;
  readonly generatedReply: string | null;
  readonly delivery: DmDeliveryState;
  readonly processedAt: number | null;
};
