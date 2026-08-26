import { isMap, type Json, type JsonMap } from '../types/json.ts';
import { Store } from '../store/store.ts';

export type QuestionEventKind = 'question_opened' | 'best_answer_selected';

export type QuestionEvent = {
  readonly sequence: number;
  readonly key: string;
  readonly kind: QuestionEventKind;
  readonly submissionId: string;
  readonly subreddit: string;
  readonly title: string;
  readonly summary: string;
  readonly submissionAuthor: string;
  readonly submissionPermalink: string;
  readonly selectionCommentId: string | null;
  readonly answerCommentId: string | null;
  readonly answerAuthor: string | null;
  readonly answerPermalink: string | null;
  readonly at: number;
};

export type QuestionEventPage = {
  readonly events: readonly QuestionEvent[];
  readonly next: number;
};

export type QuestionOpenedInput = {
  readonly submissionId: string;
  readonly subreddit: string;
  readonly title: string;
  readonly summary?: string;
  readonly submissionAuthor: string;
  readonly submissionPermalink: string;
  readonly at: number;
};

export type BestAnswerSelectedInput = QuestionOpenedInput & {
  readonly selectionCommentId: string;
  readonly answerCommentId: string;
  readonly answerAuthor: string | null;
  readonly answerPermalink: string;
};

const initial = (): JsonMap => ({ schema: 1, nextSequence: 1, events: [] });
const text = (value: Json | undefined): string => typeof value === 'string' ? value : '';
const integer = (value: Json | undefined): number =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : 0;

const root = (value: Json): JsonMap => {
  if (!isMap(value) || value['schema'] !== 1) throw new Error('Unsupported question event store');
  if (!Array.isArray(value['events'])) value['events'] = [];
  const next = integer(value['nextSequence']);
  if (next < 1) value['nextSequence'] = 1;
  return value;
};

const decode = (value: Json | undefined): QuestionEvent | null => {
  if (!isMap(value)) return null;
  const sequence = integer(value['sequence']);
  const kind = value['kind'];
  const key = text(value['key']);
  const submissionId = text(value['submissionId']);
  if (
    sequence < 1
    || (kind !== 'question_opened' && kind !== 'best_answer_selected')
    || key.length === 0
    || submissionId.length === 0
  ) return null;

  const selectionCommentId = text(value['selectionCommentId']);
  const answerCommentId = text(value['answerCommentId']);
  const answerAuthor = text(value['answerAuthor']);
  const answerPermalink = text(value['answerPermalink']);
  if (kind === 'best_answer_selected' && (answerCommentId.length === 0 || answerPermalink.length === 0)) return null;

  return {
    sequence,
    key,
    kind,
    submissionId,
    subreddit: text(value['subreddit']),
    title: text(value['title']),
    summary: text(value['summary']),
    submissionAuthor: text(value['submissionAuthor']),
    submissionPermalink: text(value['submissionPermalink']),
    selectionCommentId: selectionCommentId.length === 0 ? null : selectionCommentId,
    answerCommentId: answerCommentId.length === 0 ? null : answerCommentId,
    answerAuthor: answerAuthor.length === 0 ? null : answerAuthor,
    answerPermalink: answerPermalink.length === 0 ? null : answerPermalink,
    at: Math.max(0, integer(value['at'])),
  };
};

const encode = (event: QuestionEvent): JsonMap => ({
  sequence: event.sequence,
  key: event.key,
  kind: event.kind,
  submissionId: event.submissionId,
  subreddit: event.subreddit,
  title: event.title,
  summary: event.summary,
  submissionAuthor: event.submissionAuthor,
  submissionPermalink: event.submissionPermalink,
  selectionCommentId: event.selectionCommentId ?? '',
  answerCommentId: event.answerCommentId ?? '',
  answerAuthor: event.answerAuthor ?? '',
  answerPermalink: event.answerPermalink ?? '',
  at: event.at,
});

const validateBase = (input: QuestionOpenedInput): void => {
  if (input.submissionId.trim().length === 0) throw new Error('Question submission ID is required');
  if (input.subreddit.trim().length === 0) throw new Error('Question subreddit is required');
  if (input.submissionPermalink.trim().length === 0) throw new Error('Question submission permalink is required');
  if (!Number.isSafeInteger(input.at) || input.at < 0) throw new Error('Question event timestamp is invalid');
};

const events = (value: JsonMap): Json[] => {
  const raw = value['events'];
  if (!Array.isArray(raw)) throw new Error('Question event list is invalid');
  return raw;
};

export class QuestionEventStore {
  private readonly store: Store;

  public constructor(file = 'data/questionEvents.pb') {
    this.store = new Store(file, initial());
  }

  public async opened(input: QuestionOpenedInput): Promise<QuestionEvent> {
    validateBase(input);
    return await this.append({
      key: `question_opened:${input.submissionId}`,
      kind: 'question_opened',
      ...input,
      summary: input.summary?.trim() ?? '',
      selectionCommentId: null,
      answerCommentId: null,
      answerAuthor: null,
      answerPermalink: null,
    });
  }

  public async bestAnswer(input: BestAnswerSelectedInput): Promise<QuestionEvent> {
    validateBase(input);
    if (input.selectionCommentId.trim().length === 0) throw new Error('Best-answer selection comment ID is required');
    if (input.answerCommentId.trim().length === 0) throw new Error('Best-answer comment ID is required');
    if (input.answerPermalink.trim().length === 0) throw new Error('Best-answer permalink is required');
    return await this.append({
      key: `best_answer_selected:${input.submissionId}:${input.selectionCommentId}`,
      kind: 'best_answer_selected',
      ...input,
      summary: input.summary?.trim() ?? '',
    });
  }

  public async after(after: number, limit = 100): Promise<QuestionEventPage> {
    const cursor = Math.max(0, Math.floor(after));
    const count = Math.max(1, Math.min(100, Math.floor(limit)));
    const value = root(await this.store.read());
    const page = events(value)
      .map(decode)
      .filter((item): item is QuestionEvent => item !== null && item.sequence > cursor)
      .sort((a, b) => a.sequence - b.sequence)
      .slice(0, count);
    return {
      events: page,
      next: page.at(-1)?.sequence ?? cursor,
    };
  }

  private async append(input: Omit<QuestionEvent, 'sequence'>): Promise<QuestionEvent> {
    let out: QuestionEvent | null = null;
    await this.store.edit(current => {
      const value = root(current);
      const list = events(value);
      const existing = list.map(decode).find(item => item?.key === input.key) ?? null;
      if (existing !== null) {
        out = existing;
        return value;
      }
      const sequence = Math.max(1, integer(value['nextSequence']));
      const event: QuestionEvent = { sequence, ...input };
      list.push(encode(event));
      value['nextSequence'] = sequence + 1;
      out = event;
      return value;
    });
    if (out === null) throw new Error('Failed to append question event');
    return out;
  }
}
