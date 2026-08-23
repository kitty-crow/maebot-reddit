export type ModmailMediaKind = 'image' | 'video';

export type ModmailMediaAttachment = {
  readonly id: string;
  readonly conversationId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly kind: ModmailMediaKind;
  readonly url: string;
  readonly size: number;
  readonly createdAt: number;
};

export type ModmailMediaUpload = {
  readonly conversationId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
};
