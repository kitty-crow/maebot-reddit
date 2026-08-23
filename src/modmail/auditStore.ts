import { Store } from '../store/store.ts';
import { isMap, type Json, type JsonMap } from '../types/json.ts';

export type ModmailAuditConversationState = {
  readonly conversationId: string;
  readonly openaiConversationId: string | null;
  readonly lastSequence: number;
  readonly lastMessageId: string | null;
};

const initial = (): JsonMap => ({
  schema: 1,
  cursor: 0,
  conversations: {},
});

const root = (value: Json): JsonMap => {
  if (!isMap(value) || value['schema'] !== 1) throw new Error('Unsupported modmail audit store');
  if (!isMap(value['conversations'])) value['conversations'] = {};
  if (typeof value['cursor'] !== 'number' || !Number.isSafeInteger(value['cursor']) || value['cursor'] < 0) {
    value['cursor'] = 0;
  }
  return value;
};

const text = (value: Json | undefined): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const integer = (value: Json | undefined): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;

const conversationFrom = (value: Json | undefined): ModmailAuditConversationState | null => {
  if (!isMap(value)) return null;
  const conversationId = text(value['conversationId']);
  if (conversationId === null) return null;
  return {
    conversationId,
    openaiConversationId: text(value['openaiConversationId']),
    lastSequence: integer(value['lastSequence']),
    lastMessageId: text(value['lastMessageId']),
  };
};

export class ModmailAuditStore {
  private readonly store: Store;

  public constructor(file = 'data/modmailAudit.pb') {
    this.store = new Store(file, initial());
  }

  public async cursor(): Promise<number> {
    return integer(root(await this.store.read())['cursor']);
  }

  public async conversation(conversationId: string): Promise<ModmailAuditConversationState | null> {
    const value = root(await this.store.read());
    const conversations = value['conversations'];
    if (!isMap(conversations)) throw new Error('Modmail audit conversation map is missing');
    return conversationFrom(conversations[conversationId]);
  }

  public async advance(
    sequence: number,
    conversationId: string,
    messageId: string,
    openaiConversationId: string | null,
  ): Promise<void> {
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('Modmail audit sequence must be positive');
    if (conversationId.trim().length === 0) throw new Error('Modmail audit conversation id is required');
    if (messageId.trim().length === 0) throw new Error('Modmail audit message id is required');

    await this.store.edit(current => {
      const value = root(current);
      const cursor = integer(value['cursor']);
      if (sequence <= cursor) return value;
      if (sequence !== cursor + 1) {
        throw new Error(`Modmail audit cursor cannot skip from ${cursor} to ${sequence}`);
      }
      const conversations = value['conversations'];
      if (!isMap(conversations)) throw new Error('Modmail audit conversation map is missing');
      const previous = conversationFrom(conversations[conversationId]);
      conversations[conversationId] = {
        conversationId,
        openaiConversationId: openaiConversationId ?? previous?.openaiConversationId ?? null,
        lastSequence: sequence,
        lastMessageId: messageId,
      };
      value['cursor'] = sequence;
      return value;
    });
  }
}
