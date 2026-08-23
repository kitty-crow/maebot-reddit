import { randomBytes } from 'node:crypto';
import { Store } from '../../store/store.ts';
import { isMap, type Json, type JsonMap } from '../../types/json.ts';
import type { ModmailMediaAttachment, ModmailMediaKind } from './types.ts';

const initial = (): JsonMap => ({ schema: 1, attachments: {} });

const root = (value: Json): JsonMap => {
  if (!isMap(value) || value['schema'] !== 1) throw new Error('Unsupported Modmail media store');
  if (!isMap(value['attachments'])) value['attachments'] = {};
  return value;
};

const text = (value: Json | undefined): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;
const integer = (value: Json | undefined): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
const kind = (value: Json | undefined): ModmailMediaKind | null =>
  value === 'image' || value === 'video' ? value : null;

const attachmentJson = (value: ModmailMediaAttachment): JsonMap => ({
  id: value.id,
  conversationId: value.conversationId,
  name: value.name,
  mimeType: value.mimeType,
  kind: value.kind,
  url: value.url,
  size: value.size,
  createdAt: value.createdAt,
});

const attachmentFrom = (value: Json | undefined): ModmailMediaAttachment | null => {
  if (!isMap(value)) return null;
  const id = text(value['id']);
  const conversationId = text(value['conversationId']);
  const name = text(value['name']);
  const mimeType = text(value['mimeType']);
  const mediaKind = kind(value['kind']);
  const url = text(value['url']);
  if (id === null || conversationId === null || name === null || mimeType === null || mediaKind === null || url === null) {
    return null;
  }
  return {
    id,
    conversationId,
    name,
    mimeType,
    kind: mediaKind,
    url,
    size: integer(value['size']),
    createdAt: integer(value['createdAt']),
  };
};

export class ModmailMediaStore {
  private readonly store: Store;

  public constructor(file = 'data/modmailMedia.pb') {
    this.store = new Store(file, initial());
  }

  public async add(input: Omit<ModmailMediaAttachment, 'id'>): Promise<ModmailMediaAttachment> {
    const id = randomBytes(18).toString('base64url');
    const attachment: ModmailMediaAttachment = { id, ...input };
    await this.store.edit(current => {
      const value = root(current);
      const attachments = value['attachments'];
      if (!isMap(attachments)) throw new Error('Modmail media map is missing');
      attachments[id] = attachmentJson(attachment);
      return value;
    });
    return attachment;
  }

  public async get(id: string): Promise<ModmailMediaAttachment | null> {
    const value = root(await this.store.read());
    const attachments = value['attachments'];
    if (!isMap(attachments)) throw new Error('Modmail media map is missing');
    return attachmentFrom(attachments[id]);
  }

  public async resolve(conversationId: string, ids: readonly string[]): Promise<readonly ModmailMediaAttachment[]> {
    const unique = [...new Set(ids)];
    const output: ModmailMediaAttachment[] = [];
    for (const id of unique) {
      const attachment = await this.get(id);
      if (attachment === null || attachment.conversationId !== conversationId) {
        throw new Error(`Unknown Modmail attachment ${id}`);
      }
      output.push(attachment);
    }
    return output;
  }
}
