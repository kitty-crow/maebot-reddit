import { Store } from '../store/store.ts';
import { isMap, type Json, type JsonMap } from '../types/json.ts';
import type { ModmailModeratorIdentity } from './types.ts';

export type ModmailReplyAttachment = {
  readonly id: string;
  readonly conversationId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly kind: 'image' | 'video' | 'file';
  /** Mae's 24-hour public URL exposed back to the moderator ticket. */
  readonly url: string;
  /** URL actually sent to the Reddit participant; native when available. */
  readonly deliveryUrl: string;
  readonly size: number;
  readonly createdAt: number;
  readonly expiresAt: number;
};

export type ModmailReplyIntent = {
  readonly key: string;
  readonly conversationId: string;
  readonly moderator: ModmailModeratorIdentity;
  /** Opaque stable Mae Nya identity; absent on pre-Nya/legacy relays. */
  readonly authorNyaId?: string;
  readonly text: string;
  readonly attachments: readonly ModmailReplyAttachment[];
  readonly bodyMarkdown: string;
  readonly createdAt: number;
  readonly appliedAt: number | null;
  readonly lastError: string | null;
};

const initial = (): JsonMap => ({ schema: 1, replies: {} });

const root = (value: Json): JsonMap => {
  if (!isMap(value) || value['schema'] !== 1) throw new Error('Unsupported modmail outbox store');
  if (!isMap(value['replies'])) value['replies'] = {};
  return value;
};

const text = (value: Json | undefined): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;
const integerOrNull = (value: Json | undefined): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
const nyaId = (value: Json | undefined): string | undefined =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{20,128}$/u.test(value) ? value : undefined;

const attachmentFrom = (value: Json | undefined): ModmailReplyAttachment | null => {
  if (!isMap(value)) return null;
  const id = text(value['id']);
  const conversationId = text(value['conversationId']);
  const name = text(value['name']);
  const mimeType = text(value['mimeType']);
  const kind = value['kind'];
  const url = text(value['url']);
  const size = integerOrNull(value['size']);
  const createdAt = integerOrNull(value['createdAt']);
  if (
    id === null || conversationId === null || name === null || mimeType === null || url === null
    || (kind !== 'image' && kind !== 'video' && kind !== 'file') || size === null || createdAt === null
  ) return null;
  const deliveryUrl = text(value['deliveryUrl']) ?? url;
  const expiresAt = integerOrNull(value['expiresAt']) ?? createdAt + (24 * 60 * 60);
  return { id, conversationId, name, mimeType, kind, url, deliveryUrl, size, createdAt, expiresAt };
};

const attachmentJson = (value: ModmailReplyAttachment): JsonMap => ({
  id: value.id,
  conversationId: value.conversationId,
  name: value.name,
  mimeType: value.mimeType,
  kind: value.kind,
  url: value.url,
  deliveryUrl: value.deliveryUrl,
  size: value.size,
  createdAt: value.createdAt,
  expiresAt: value.expiresAt,
});

const replyFrom = (value: Json | undefined): ModmailReplyIntent | null => {
  if (!isMap(value) || !isMap(value['moderator'])) return null;
  const key = text(value['key']);
  const conversationId = text(value['conversationId']);
  const platform = value['moderator']['platform'];
  const userId = text(value['moderator']['userId']);
  const handle = text(value['moderator']['handle']);
  const bodyMarkdown = text(value['bodyMarkdown']);
  if (
    key === null || conversationId === null || userId === null || handle === null || bodyMarkdown === null
    || (platform !== 'discord' && platform !== 'telegram')
  ) return null;
  const rawNyaId = value['authorNyaId'];
  const authorNyaId = nyaId(rawNyaId);
  if (rawNyaId !== undefined && authorNyaId === undefined) return null;
  const attachments = Array.isArray(value['attachments'])
    ? value['attachments'].map(attachmentFrom).filter((item): item is ModmailReplyAttachment => item !== null)
    : [];
  return {
    key,
    conversationId,
    moderator: { platform, userId, handle },
    ...(authorNyaId === undefined ? {} : { authorNyaId }),
    text: text(value['text']) ?? '',
    attachments,
    bodyMarkdown,
    createdAt: integerOrNull(value['createdAt']) ?? 0,
    appliedAt: integerOrNull(value['appliedAt']),
    lastError: text(value['lastError']),
  };
};

const replyJson = (value: ModmailReplyIntent): JsonMap => ({
  key: value.key,
  conversationId: value.conversationId,
  moderator: {
    platform: value.moderator.platform,
    userId: value.moderator.userId,
    handle: value.moderator.handle,
  },
  ...(value.authorNyaId === undefined ? {} : { authorNyaId: value.authorNyaId }),
  text: value.text,
  attachments: value.attachments.map(attachmentJson),
  bodyMarkdown: value.bodyMarkdown,
  createdAt: value.createdAt,
  appliedAt: value.appliedAt,
  lastError: value.lastError,
});

export const modmailReplyAttribution = (moderator: ModmailModeratorIdentity): string => {
  const platform = moderator.platform === 'discord' ? 'Discord' : 'Telegram';
  return `**Reply from ${moderator.handle} via ${platform}:**`;
};

const attachmentLabel = (attachment: ModmailReplyAttachment): string => {
  const icon = attachment.kind === 'image' ? '🖼️' : attachment.kind === 'video' ? '🎞️' : '📎';
  const name = attachment.name.replace(/[\[\]]/gu, '_');
  return `- [${icon} ${name}](${attachment.deliveryUrl})`;
};

export const attributedModmailReply = (
  moderator: ModmailModeratorIdentity,
  textBody: string,
  attachments: readonly ModmailReplyAttachment[] = [],
): string => {
  const body = textBody.trim();
  if (body.length === 0 && attachments.length === 0) throw new Error('Modmail reply cannot be empty');
  const parts = [modmailReplyAttribution(moderator)];
  if (body.length > 0) parts.push(body);
  if (attachments.length > 0) parts.push(`**Attachments:**\n${attachments.map(attachmentLabel).join('\n')}`);
  return parts.join('\n\n');
};

export class ModmailReplyOutbox {
  private readonly store: Store;

  public constructor(file = 'data/modmailReplies.pb') {
    this.store = new Store(file, initial());
  }

  public async queue(input: {
    readonly key: string;
    readonly conversationId: string;
    readonly moderator: ModmailModeratorIdentity;
    readonly authorNyaId?: string;
    readonly text: string;
    readonly attachments?: readonly ModmailReplyAttachment[];
    readonly createdAt?: number;
  }): Promise<ModmailReplyIntent> {
    const key = input.key.trim();
    const conversationId = input.conversationId.trim();
    const attachments = input.attachments ?? [];
    if (key.length === 0) throw new Error('Modmail reply idempotency key is required');
    if (!/^[A-Za-z0-9]+$/u.test(conversationId)) throw new Error('Modmail reply conversation id is invalid');
    if (input.authorNyaId !== undefined && !/^[A-Za-z0-9_-]{20,128}$/u.test(input.authorNyaId)) {
      throw new Error('Modmail reply Nya author id is invalid');
    }
    if (attachments.some(attachment => attachment.conversationId !== conversationId)) {
      throw new Error('Modmail attachment belongs to another conversation');
    }
    const bodyMarkdown = attributedModmailReply(input.moderator, input.text, attachments);
    let output: ModmailReplyIntent | null = null;
    await this.store.edit(current => {
      const value = root(current);
      const replies = value['replies'];
      if (!isMap(replies)) throw new Error('Modmail reply map is missing');
      const existing = replyFrom(replies[key]);
      if (existing !== null) {
        if (
          existing.conversationId !== conversationId
          || existing.moderator.platform !== input.moderator.platform
          || existing.moderator.userId !== input.moderator.userId
          || existing.authorNyaId !== input.authorNyaId
          || existing.bodyMarkdown !== bodyMarkdown
        ) throw new Error(`Modmail reply key ${key} was reused with different content`);
        output = existing;
        return value;
      }
      const next: ModmailReplyIntent = {
        key,
        conversationId,
        moderator: input.moderator,
        ...(input.authorNyaId === undefined ? {} : { authorNyaId: input.authorNyaId }),
        text: input.text.trim(),
        attachments,
        bodyMarkdown,
        createdAt: input.createdAt ?? Math.floor(Date.now() / 1_000),
        appliedAt: null,
        lastError: null,
      };
      replies[key] = replyJson(next);
      output = next;
      return value;
    });
    if (output === null) throw new Error('Failed to queue modmail reply');
    return output;
  }

  private async replies(): Promise<readonly ModmailReplyIntent[]> {
    const value = root(await this.store.read());
    const replies = value['replies'];
    if (!isMap(replies)) throw new Error('Modmail reply map is missing');
    return Object.values(replies)
      .map(replyFrom)
      .filter((reply): reply is ModmailReplyIntent => reply !== null)
      .sort((a, b) => a.createdAt - b.createdAt || a.key.localeCompare(b.key));
  }

  public async pending(): Promise<readonly ModmailReplyIntent[]> {
    return (await this.replies()).filter(reply => reply.appliedAt === null);
  }

  public async appliedForConversation(conversationId: string): Promise<readonly ModmailReplyIntent[]> {
    return (await this.replies()).filter(reply =>
      reply.conversationId === conversationId && reply.appliedAt !== null);
  }

  public async markApplied(key: string, at = Math.floor(Date.now() / 1_000)): Promise<void> {
    await this.store.edit(current => {
      const value = root(current);
      const replies = value['replies'];
      if (!isMap(replies)) throw new Error('Modmail reply map is missing');
      const existing = replyFrom(replies[key]);
      if (existing !== null) replies[key] = replyJson({ ...existing, appliedAt: at, lastError: null });
      return value;
    });
  }

  public async markFailed(key: string, error: string): Promise<void> {
    await this.store.edit(current => {
      const value = root(current);
      const replies = value['replies'];
      if (!isMap(replies)) throw new Error('Modmail reply map is missing');
      const existing = replyFrom(replies[key]);
      if (existing !== null) replies[key] = replyJson({ ...existing, lastError: error.slice(0, 500) });
      return value;
    });
  }
}
