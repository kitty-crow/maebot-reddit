import { Store } from '../store/store.ts';
import { isMap, type Json, type JsonMap } from '../types/json.ts';
import type {
  ModmailConversation,
  ModmailConversationKind,
  ModmailConversationState,
  ModmailMessage,
  ModmailModeratorIdentity,
  ModmailParticipant,
} from './types.ts';

export type ModmailRelayOrigin = ModmailModeratorIdentity['platform'] | null;

export type ModmailRelayEvent = {
  readonly sequence: number;
  readonly key: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly subreddit: string;
  readonly subject: string;
  readonly participant: string | null;
  readonly author: string | null;
  readonly participatingAs: string | null;
  readonly bodyMarkdown: string;
  readonly isInternal: boolean;
  readonly createdAt: number;
  readonly relayOrigin: ModmailRelayOrigin;
};

export type ModmailRelayEventPage = {
  readonly events: readonly ModmailRelayEvent[];
  readonly next: number;
};

export type ModmailStoreListener = (conversationIds: readonly string[]) => void | Promise<void>;

const initial = (): JsonMap => ({
  schema: 1,
  bootstrappedAt: 0,
  sequence: 0,
  subreddits: {},
  conversations: {},
  events: {},
});

const normaliseSubreddit = (value: string): string => value.trim().toLowerCase();

const root = (value: Json): JsonMap => {
  if (!isMap(value) || value['schema'] !== 1) throw new Error('Unsupported modmail store');
  if (!isMap(value['conversations'])) value['conversations'] = {};
  if (!isMap(value['events'])) value['events'] = {};
  if (!isMap(value['subreddits'])) {
    const subreddits: JsonMap = {};
    const conversations = value['conversations'];
    if (isMap(conversations)) {
      for (const raw of Object.values(conversations)) {
        if (!isMap(raw) || typeof raw['subreddit'] !== 'string') continue;
        const key = normaliseSubreddit(raw['subreddit']);
        if (key.length > 0) subreddits[key] = true;
      }
    }
    value['subreddits'] = subreddits;
  }
  return value;
};

const text = (value: Json | undefined): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;
const integer = (value: Json | undefined): number =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : 0;
const bool = (value: Json | undefined): boolean => value === true;
const relayOrigin = (value: Json | undefined): ModmailRelayOrigin =>
  value === 'discord' || value === 'telegram' ? value : null;

const participantJson = (value: ModmailParticipant | null): Json => value === null ? null : ({
  id: value.id,
  name: value.name,
  isModerator: value.isModerator,
  isAdmin: value.isAdmin,
  isParticipant: value.isParticipant,
  isHidden: value.isHidden,
  isDeleted: value.isDeleted,
});

const participantFrom = (value: Json | undefined): ModmailParticipant | null => {
  if (!isMap(value)) return null;
  return {
    id: text(value['id']),
    name: text(value['name']),
    isModerator: bool(value['isModerator']),
    isAdmin: bool(value['isAdmin']),
    isParticipant: bool(value['isParticipant']),
    isHidden: bool(value['isHidden']),
    isDeleted: bool(value['isDeleted']),
  };
};

const messageJson = (value: ModmailMessage): JsonMap => ({
  id: value.id,
  conversationId: value.conversationId,
  author: participantJson(value.author),
  bodyMarkdown: value.bodyMarkdown,
  createdAt: value.createdAt,
  isInternal: value.isInternal,
  participatingAs: value.participatingAs,
});

const messageFrom = (value: Json | undefined): ModmailMessage | null => {
  if (!isMap(value)) return null;
  const id = text(value['id']);
  const conversationId = text(value['conversationId']);
  if (id === null || conversationId === null) return null;
  return {
    id,
    conversationId,
    author: participantFrom(value['author']),
    bodyMarkdown: text(value['bodyMarkdown']) ?? '',
    createdAt: integer(value['createdAt']),
    isInternal: bool(value['isInternal']),
    participatingAs: text(value['participatingAs']),
  };
};

const stateFrom = (value: Json | undefined): ModmailConversationState => {
  if (
    value === 'new' || value === 'inprogress' || value === 'archived'
    || value === 'appeals' || value === 'join_requests' || value === 'filtered'
  ) return value;
  return 'unknown';
};

const kindFrom = (value: Json | undefined): ModmailConversationKind => {
  if (value === 'sr_user' || value === 'sr_sr' || value === 'internal') return value;
  return 'unknown';
};

const conversationJson = (value: ModmailConversation): JsonMap => ({
  id: value.id,
  subreddit: value.subreddit,
  subject: value.subject,
  participant: participantJson(value.participant),
  kind: value.kind,
  state: value.state,
  isInternal: value.isInternal,
  isAuto: value.isAuto,
  lastUpdatedAt: value.lastUpdatedAt,
  messages: Object.fromEntries(value.messages.map(message => [message.id, messageJson(message)])),
});

const conversationFrom = (value: Json | undefined): ModmailConversation | null => {
  if (!isMap(value)) return null;
  const id = text(value['id']);
  if (id === null) return null;
  const rawMessages = value['messages'];
  const messages = isMap(rawMessages)
    ? Object.values(rawMessages)
      .map(messageFrom)
      .filter((message): message is ModmailMessage => message !== null)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    : [];
  return {
    id,
    subreddit: text(value['subreddit']) ?? '',
    subject: text(value['subject']) ?? '',
    participant: participantFrom(value['participant']),
    kind: kindFrom(value['kind']),
    state: stateFrom(value['state']),
    isInternal: bool(value['isInternal']),
    isAuto: bool(value['isAuto']),
    lastUpdatedAt: integer(value['lastUpdatedAt']),
    messages,
  };
};

const mergeConversation = (
  prior: ModmailConversation | null,
  incoming: ModmailConversation,
): ModmailConversation => {
  const messages = new Map<string, ModmailMessage>();
  for (const message of prior?.messages ?? []) messages.set(message.id, message);
  for (const message of incoming.messages) messages.set(message.id, message);
  return {
    ...incoming,
    messages: [...messages.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
  };
};

const eventJson = (value: ModmailRelayEvent): JsonMap => ({
  sequence: value.sequence,
  key: value.key,
  conversationId: value.conversationId,
  messageId: value.messageId,
  subreddit: value.subreddit,
  subject: value.subject,
  participant: value.participant,
  author: value.author,
  participatingAs: value.participatingAs,
  bodyMarkdown: value.bodyMarkdown,
  isInternal: value.isInternal,
  createdAt: value.createdAt,
  relayOrigin: value.relayOrigin,
});

const eventFrom = (value: Json | undefined): ModmailRelayEvent | null => {
  if (!isMap(value)) return null;
  const key = text(value['key']);
  const conversationId = text(value['conversationId']);
  const messageId = text(value['messageId']);
  const sequence = integer(value['sequence']);
  if (key === null || conversationId === null || messageId === null || sequence < 1) return null;
  return {
    sequence,
    key,
    conversationId,
    messageId,
    subreddit: text(value['subreddit']) ?? '',
    subject: text(value['subject']) ?? '',
    participant: text(value['participant']),
    author: text(value['author']),
    participatingAs: text(value['participatingAs']),
    bodyMarkdown: text(value['bodyMarkdown']) ?? '',
    isInternal: bool(value['isInternal']),
    createdAt: integer(value['createdAt']),
    relayOrigin: relayOrigin(value['relayOrigin']),
  };
};

const eventFor = (sequence: number, conversation: ModmailConversation, message: ModmailMessage): ModmailRelayEvent => ({
  sequence,
  key: `modmail:${conversation.id}:${message.id}`,
  conversationId: conversation.id,
  messageId: message.id,
  subreddit: conversation.subreddit,
  subject: conversation.subject,
  participant: conversation.participant?.name ?? null,
  author: message.author?.name ?? null,
  participatingAs: message.participatingAs,
  bodyMarkdown: message.bodyMarkdown,
  isInternal: message.isInternal,
  createdAt: message.createdAt,
  relayOrigin: null,
});

export class ModmailStore {
  private readonly store: Store;
  private readonly listeners = new Set<ModmailStoreListener>();

  public constructor(file = 'data/modmail.pb') {
    this.store = new Store(file, initial());
  }

  public subscribe(listener: ModmailStoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(conversationIds: readonly string[]): void {
    if (conversationIds.length === 0) return;
    for (const listener of this.listeners) {
      void Promise.resolve(listener(conversationIds)).catch(error => {
        console.error('[Reddit modmail] store listener failed:', error);
      });
    }
  }

  public async sync(
    conversations: readonly ModmailConversation[],
    at = Math.floor(Date.now() / 1_000),
    activeSubreddits: readonly string[] = [],
  ): Promise<readonly ModmailRelayEvent[]> {
    let created: ModmailRelayEvent[] = [];
    const changed = new Set<string>();
    await this.store.edit(current => {
      const value = root(current);
      const conversationMap = value['conversations'];
      const events = value['events'];
      const subredditMap = value['subreddits'];
      if (!isMap(conversationMap) || !isMap(events) || !isMap(subredditMap)) {
        throw new Error('Modmail store maps are missing');
      }
      const bootstrappedAt = integer(value['bootstrappedAt']);
      const firstSync = bootstrappedAt === 0;
      if (firstSync) value['bootstrappedAt'] = at;
      let sequence = integer(value['sequence']);
      const newlyActivated = new Set(
        activeSubreddits
          .map(normaliseSubreddit)
          .filter(key => key.length > 0 && subredditMap[key] !== true),
      );

      for (const incoming of conversations) {
        const participantName = incoming.participant?.name ?? null;
        if (incoming.kind !== 'sr_user' || participantName === null) continue;
        const prior = conversationFrom(conversationMap[incoming.id]);
        const known = new Set(prior?.messages.map(message => message.id) ?? []);
        const merged = mergeConversation(prior, incoming);
        conversationMap[incoming.id] = conversationJson(merged);
        const newMessages = incoming.messages.filter(message => !known.has(message.id));
        if (
          prior === null
          || newMessages.length > 0
          || prior.state !== incoming.state
          || prior.subject !== incoming.subject
          || prior.lastUpdatedAt !== incoming.lastUpdatedAt
        ) changed.add(incoming.id);
        if (firstSync || newlyActivated.has(normaliseSubreddit(incoming.subreddit))) continue;
        for (const message of newMessages) {
          sequence += 1;
          const event = eventFor(sequence, merged, message);
          events[String(sequence)] = eventJson(event);
          created.push(event);
        }
      }

      for (const subreddit of activeSubreddits) {
        const key = normaliseSubreddit(subreddit);
        if (key.length > 0) subredditMap[key] = true;
      }
      value['sequence'] = sequence;
      return value;
    });
    created = created.sort((a, b) => a.sequence - b.sequence);
    this.publish([...changed]);
    return created;
  }

  public async markReplyOrigin(
    conversationId: string,
    bodyMarkdown: string,
    platform: Exclude<ModmailRelayOrigin, null>,
    createdAt: number,
  ): Promise<boolean> {
    let marked = false;
    await this.store.edit(current => {
      const value = root(current);
      const events = value['events'];
      if (!isMap(events)) throw new Error('Modmail event map is missing');
      const threshold = Math.max(0, createdAt - 60);
      const candidates = Object.entries(events)
        .map(([key, raw]) => ({ key, raw, event: eventFrom(raw) }))
        .filter(row =>
          row.event !== null
          && row.event.conversationId === conversationId
          && row.event.bodyMarkdown.trim() === bodyMarkdown.trim()
          && row.event.createdAt >= threshold
          && (row.event.participatingAs === 'moderator' || row.event.author !== row.event.participant))
        .sort((a, b) => (b.event?.sequence ?? 0) - (a.event?.sequence ?? 0));
      const selected = candidates[0];
      if (selected === undefined || !isMap(selected.raw)) return value;
      selected.raw['relayOrigin'] = platform;
      marked = true;
      return value;
    });
    return marked;
  }

  public async eventsAfter(after: number, limit = 100): Promise<ModmailRelayEventPage> {
    const value = root(await this.store.read());
    const events = value['events'];
    if (!isMap(events)) throw new Error('Modmail event map is missing');
    const safeAfter = Math.max(0, Math.floor(after));
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const rows = Object.values(events)
      .map(eventFrom)
      .filter((event): event is ModmailRelayEvent => event !== null && event.sequence > safeAfter)
      .sort((a, b) => a.sequence - b.sequence)
      .slice(0, safeLimit);
    return { events: rows, next: rows.at(-1)?.sequence ?? safeAfter };
  }

  public async conversation(id: string): Promise<ModmailConversation | null> {
    const value = root(await this.store.read());
    const conversations = value['conversations'];
    if (!isMap(conversations)) throw new Error('Modmail conversation map is missing');
    return conversationFrom(conversations[id]);
  }
}
