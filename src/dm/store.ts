import { Store } from '../store/store.ts';
import { isMap, type Json, type JsonMap } from '../types/json.ts';
import type {
  DmConversationState,
  DmDeliveryState,
  DmMessageState,
  RedditDirectMessage,
} from './types.ts';

const initial = (): JsonMap => ({
  schema: 1,
  bootstrapped: false,
  conversations: {},
  messages: {},
});

const root = (value: Json): JsonMap => {
  if (!isMap(value) || value['schema'] !== 1) throw new Error('Unsupported Reddit DM store');
  if (typeof value['bootstrapped'] !== 'boolean') value['bootstrapped'] = false;
  if (!isMap(value['conversations'])) value['conversations'] = {};
  if (!isMap(value['messages'])) value['messages'] = {};
  return value;
};

const mapField = (value: JsonMap, name: 'conversations' | 'messages'): JsonMap => {
  const field = value[name];
  if (!isMap(field)) throw new Error(`Reddit DM ${name} map is invalid`);
  return field;
};

const text = (value: Json | undefined): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;
const number = (value: Json | undefined): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
const bool = (value: Json | undefined): boolean => value === true;

const nullableText = (value: Json | undefined): string | null =>
  value === null || value === undefined ? null : text(value);

const delivery = (value: Json | undefined): DmDeliveryState => {
  if (value === 'seeded' || value === 'pending' || value === 'attempted' || value === 'sent' || value === 'no-reply') return value;
  throw new Error('Reddit DM delivery state is invalid');
};

const messageJson = (value: RedditDirectMessage): JsonMap => ({
  id: value.id,
  fullname: value.fullname,
  author: value.author,
  destination: value.destination,
  subject: value.subject,
  body: value.body,
  createdUtc: value.createdUtc,
  parentFullname: value.parentFullname,
  firstMessageFullname: value.firstMessageFullname,
  isNew: value.isNew,
  wasComment: value.wasComment,
});

const messageFrom = (value: Json | undefined): RedditDirectMessage => {
  if (!isMap(value)) throw new Error('Reddit DM message state is invalid');
  const id = text(value['id']);
  const fullname = text(value['fullname']);
  const createdUtc = number(value['createdUtc']);
  if (id === null || fullname === null || createdUtc === null) throw new Error('Reddit DM message identity is invalid');
  return {
    id,
    fullname,
    author: nullableText(value['author']),
    destination: nullableText(value['destination']),
    subject: typeof value['subject'] === 'string' ? value['subject'] : '',
    body: typeof value['body'] === 'string' ? value['body'] : '',
    createdUtc,
    parentFullname: nullableText(value['parentFullname']),
    firstMessageFullname: nullableText(value['firstMessageFullname']),
    isNew: bool(value['isNew']),
    wasComment: bool(value['wasComment']),
  };
};

const stateJson = (value: DmMessageState): JsonMap => ({
  message: messageJson(value.message),
  classificationApplied: value.classificationApplied,
  generatedReply: value.generatedReply,
  delivery: value.delivery,
  processedAt: value.processedAt,
});

const stateFrom = (value: Json | undefined): DmMessageState | null => {
  if (!isMap(value)) return null;
  const processedAt = value['processedAt'] === null || value['processedAt'] === undefined
    ? null
    : number(value['processedAt']);
  if (processedAt === null && value['processedAt'] !== null && value['processedAt'] !== undefined) {
    throw new Error('Reddit DM processedAt is invalid');
  }
  const generated = value['generatedReply'];
  if (generated !== null && generated !== undefined && typeof generated !== 'string') {
    throw new Error('Reddit DM generated reply is invalid');
  }
  return {
    message: messageFrom(value['message']),
    classificationApplied: bool(value['classificationApplied']),
    generatedReply: typeof generated === 'string' ? generated : null,
    delivery: delivery(value['delivery']),
    processedAt,
  };
};

const conversationJson = (value: DmConversationState): JsonMap => ({
  username: value.username,
  moderationConversationId: value.moderationConversationId,
  responseConversationId: value.responseConversationId,
});

const conversationFrom = (value: Json | undefined): DmConversationState | null => {
  if (!isMap(value)) return null;
  const username = text(value['username']);
  if (username === null) return null;
  return {
    username,
    moderationConversationId: nullableText(value['moderationConversationId']),
    responseConversationId: nullableText(value['responseConversationId']),
  };
};

const validFullname = (value: string): void => {
  if (!/^t4_[A-Za-z0-9]+$/u.test(value)) throw new Error(`Invalid Reddit DM fullname ${value}`);
};

const validThread = (value: string): void => {
  if (!/^t4_[A-Za-z0-9]+$/u.test(value)) throw new Error(`Invalid Reddit DM thread ${value}`);
};

export class DmStore {
  private readonly store: Store;

  public constructor(file: string) {
    this.store = new Store(file, initial());
  }

  public async hasBootstrap(): Promise<boolean> {
    return root(await this.store.read())['bootstrapped'] === true;
  }

  public async seed(messages: readonly RedditDirectMessage[], at: number): Promise<number> {
    if (!Number.isSafeInteger(at) || at < 0) throw new Error('Reddit DM seed time must be non-negative');
    let added = 0;
    await this.store.edit(current => {
      const value = root(current);
      const states = mapField(value, 'messages');
      for (const message of messages) {
        validFullname(message.fullname);
        if (states[message.fullname] !== undefined) continue;
        states[message.fullname] = stateJson({
          message,
          classificationApplied: false,
          generatedReply: null,
          delivery: 'seeded',
          processedAt: at,
        });
        added += 1;
      }
      value['bootstrapped'] = true;
      return value;
    });
    return added;
  }

  public async state(fullname: string): Promise<DmMessageState | null> {
    validFullname(fullname);
    const value = root(await this.store.read());
    return stateFrom(mapField(value, 'messages')[fullname]);
  }

  public async begin(message: RedditDirectMessage): Promise<DmMessageState> {
    validFullname(message.fullname);
    let output: DmMessageState | null = null;
    await this.store.edit(current => {
      const value = root(current);
      const states = mapField(value, 'messages');
      const existing = stateFrom(states[message.fullname]);
      if (existing !== null) {
        output = existing;
        return value;
      }
      output = {
        message,
        classificationApplied: false,
        generatedReply: null,
        delivery: 'pending',
        processedAt: null,
      };
      states[message.fullname] = stateJson(output);
      return value;
    });
    if (output === null) throw new Error('Reddit DM state creation failed');
    return output;
  }

  public async conversation(threadFullname: string, username: string): Promise<DmConversationState> {
    validThread(threadFullname);
    const cleanUser = username.trim();
    if (cleanUser.length === 0) throw new Error('Reddit DM username is required');
    let output: DmConversationState | null = null;
    await this.store.edit(current => {
      const value = root(current);
      const conversations = mapField(value, 'conversations');
      const existing = conversationFrom(conversations[threadFullname]);
      if (existing !== null) {
        output = existing;
        return value;
      }
      output = {
        username: cleanUser,
        moderationConversationId: null,
        responseConversationId: null,
      };
      conversations[threadFullname] = conversationJson(output);
      return value;
    });
    if (output === null) throw new Error('Reddit DM conversation state creation failed');
    return output;
  }

  public async rememberConversations(
    threadFullname: string,
    username: string,
    moderationConversationId: string | null,
    responseConversationId: string | null,
  ): Promise<void> {
    validThread(threadFullname);
    const cleanUser = username.trim();
    if (cleanUser.length === 0) throw new Error('Reddit DM username is required');
    await this.store.edit(current => {
      const value = root(current);
      mapField(value, 'conversations')[threadFullname] = conversationJson({
        username: cleanUser,
        moderationConversationId,
        responseConversationId,
      });
      return value;
    });
  }

  private async update(fullname: string, mutate: (state: DmMessageState) => DmMessageState): Promise<DmMessageState> {
    validFullname(fullname);
    let output: DmMessageState | null = null;
    await this.store.edit(current => {
      const value = root(current);
      const states = mapField(value, 'messages');
      const existing = stateFrom(states[fullname]);
      if (existing === null) throw new Error(`Unknown Reddit DM ${fullname}`);
      output = mutate(existing);
      states[fullname] = stateJson(output);
      return value;
    });
    if (output === null) throw new Error('Reddit DM state update failed');
    return output;
  }

  public async markModerated(fullname: string): Promise<DmMessageState> {
    return await this.update(fullname, state => ({ ...state, classificationApplied: true }));
  }

  public async setReply(fullname: string, reply: string): Promise<DmMessageState> {
    const text = reply.trim();
    if (text.length === 0 || text.length > 10_000) throw new Error('Reddit DM generated reply is invalid');
    return await this.update(fullname, state => ({ ...state, generatedReply: text, delivery: 'pending' }));
  }

  public async markAttempted(fullname: string): Promise<DmMessageState> {
    return await this.update(fullname, state => ({ ...state, delivery: 'attempted' }));
  }

  public async markSent(fullname: string, at: number): Promise<DmMessageState> {
    if (!Number.isSafeInteger(at) || at < 0) throw new Error('Reddit DM sent time must be non-negative');
    return await this.update(fullname, state => ({ ...state, delivery: 'sent', processedAt: at }));
  }

  public async markNoReply(fullname: string, at: number): Promise<DmMessageState> {
    if (!Number.isSafeInteger(at) || at < 0) throw new Error('Reddit DM processed time must be non-negative');
    return await this.update(fullname, state => ({ ...state, generatedReply: null, delivery: 'no-reply', processedAt: at }));
  }

  public async attempted(): Promise<readonly DmMessageState[]> {
    const value = root(await this.store.read());
    return Object.values(mapField(value, 'messages'))
      .map(stateFrom)
      .filter((state): state is DmMessageState => state !== null && state.delivery === 'attempted')
      .sort((left, right) => left.message.createdUtc - right.message.createdUtc || left.message.fullname.localeCompare(right.message.fullname));
  }
}
