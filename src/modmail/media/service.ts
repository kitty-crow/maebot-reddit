import type { ModmailStore } from '../store.ts';
import { ModmailMediaStore } from './store.ts';
import type { ModmailMediaAttachment, ModmailMediaKind, ModmailMediaUpload } from './types.ts';

export type RedditMediaUploader = {
  uploadMedia(name: string, mimeType: string, bytes: Uint8Array): Promise<string>;
};

const maxBytes = 20 * 1024 * 1024;

const kindFor = (mimeType: string): ModmailMediaKind | null => {
  if (mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/webp' || mimeType === 'image/gif') {
    return 'image';
  }
  if (mimeType === 'video/mp4' || mimeType === 'video/webm') return 'video';
  return null;
};

const safeName = (value: string): string => {
  const name = value.trim().replace(/[\\/]+/gu, '_').replace(/[\u0000-\u001f\u007f]+/gu, '').slice(0, 180);
  if (name.length === 0) throw new Error('Modmail attachment filename is required');
  return name;
};

export class ModmailMediaService {
  public constructor(
    private readonly conversations: Pick<ModmailStore, 'conversation'>,
    private readonly uploader: RedditMediaUploader,
    private readonly store: ModmailMediaStore,
  ) {}

  public async upload(input: ModmailMediaUpload): Promise<ModmailMediaAttachment> {
    const conversationId = input.conversationId.trim();
    if (!/^[A-Za-z0-9]+$/u.test(conversationId)) throw new Error('Invalid Modmail conversation id');
    const conversation = await this.conversations.conversation(conversationId);
    if (conversation === null) throw new Error('Modmail conversation not found');
    if (conversation.state === 'archived') throw new Error('Modmail conversation is archived');

    const name = safeName(input.name);
    const mimeType = input.mimeType.trim().toLowerCase();
    const kind = kindFor(mimeType);
    if (kind === null) throw new Error('Unsupported Modmail media type');
    if (input.bytes.byteLength < 1 || input.bytes.byteLength > maxBytes) {
      throw new Error('Modmail media must be between 1 byte and 20 MB');
    }

    const url = await this.uploader.uploadMedia(name, mimeType, input.bytes);
    return await this.store.add({
      conversationId,
      name,
      mimeType,
      kind,
      url,
      size: input.bytes.byteLength,
      createdAt: Math.floor(Date.now() / 1_000),
    });
  }

  public async resolve(conversationId: string, ids: readonly string[]): Promise<readonly ModmailMediaAttachment[]> {
    if (ids.length > 8) throw new Error('A Modmail reply can include at most 8 media attachments');
    return await this.store.resolve(conversationId, ids);
  }
}
