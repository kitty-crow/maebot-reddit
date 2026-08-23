import { Store } from '../store/store.ts';
import { isMap, type Json, type JsonMap } from '../types/json.ts';
import type { ModmailModeratorIdentity } from './types.ts';

export type ModmailReplyIntent = {
  readonly key: string;
  readonly conversationId: string;
  readonly moderator: ModmailModeratorIdentity;
  readonly text: string;
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
  return {
    key,
    conversationId,
    moderator: { platform, userId, handle },
    text: text(value['text']) ?? '',
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
  text: value.text,
  bodyMarkdown: value.bodyMarkdown,
  createdAt: value.createdAt,
  appliedAt: value.appliedAt,
  lastError: value.lastError,
});

export const attributedModmailReply = (moderator: ModmailModeratorIdentity, textBody: string): string => {
  const text = textBody.trim();
  if (text.length === 0) throw new Error('Modmail reply cannot be empty');
  const platform = moderator.platform === 'discord' ? 'Discord' : 'Telegram';
  return `**Reply from ${moderator.handle} via ${platform}:**\n\n${text}`;
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
    readonly text: string;
    readonly createdAt?: number;
  }): Promise<ModmailReplyIntent> {
    const key = input.key.trim();
    const conversationId = input.conversationId.trim();
    if (key.length === 0) throw new Error('Modmail reply idempotency key is required');
    if (!/^[A-Za-z0-9]+$/u.test(conversationId)) throw new Error('Modmail reply conversation id is invalid');
    const bodyMarkdown = attributedModmailReply(input.moderator, input.text);
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
          || existing.bodyMarkdown !== bodyMarkdown
        ) throw new Error(`Modmail reply key ${key} was reused with different content`);
        output = existing;
        return value;
      }
      const next: ModmailReplyIntent = {
        key,
        conversationId,
        moderator: input.moderator,
        text: input.text.trim(),
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

  public async pending(): Promise<readonly ModmailReplyIntent[]> {
    const value = root(await this.store.read());
    const replies = value['replies'];
    if (!isMap(replies)) throw new Error('Modmail reply map is missing');
    return Object.values(replies)
      .map(replyFrom)
      .filter((reply): reply is ModmailReplyIntent => reply !== null && reply.appliedAt === null)
      .sort((a, b) => a.createdAt - b.createdAt || a.key.localeCompare(b.key));
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
