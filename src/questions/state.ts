import { isMap, type Json, type JsonMap } from '../types/json.ts';
import { Store } from '../store/store.ts';

export type QuestionStateInput = {
  readonly submissionId: string;
  readonly subreddit: string;
  readonly title: string;
  readonly summary?: string;
  readonly author: string | null;
  readonly permalink: string;
  readonly createdAt: number;
};

export type QuestionStateRecord = Omit<QuestionStateInput, 'summary'> & {
  readonly summary: string;
  readonly openedHandled: boolean;
  readonly bestAnswerCommentId: string | null;
  readonly updatedAt: number;
};

const initial = (): JsonMap => ({
  schema: 1,
  activated: {},
  questions: {},
  commands: {},
});

const root = (value: Json): JsonMap => {
  if (!isMap(value) || value['schema'] !== 1) throw new Error('Unsupported question state store');
  return value;
};

const child = (parent: JsonMap, key: string): JsonMap => {
  const value = parent[key];
  if (isMap(value)) return value;
  const created: JsonMap = {};
  parent[key] = created;
  return created;
};

const text = (value: Json | undefined): string => typeof value === 'string' ? value : '';
const integer = (value: Json | undefined): number =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : 0;
const keyFor = (subreddit: string): string => subreddit.trim().toLowerCase();

const decodeQuestion = (value: Json | undefined): QuestionStateRecord | null => {
  if (!isMap(value)) return null;
  const submissionId = text(value['submissionId']);
  const subreddit = text(value['subreddit']);
  if (submissionId.length === 0 || subreddit.length === 0) return null;
  const author = text(value['author']);
  const bestAnswer = text(value['bestAnswerCommentId']);
  return {
    submissionId,
    subreddit,
    title: text(value['title']),
    summary: text(value['summary']),
    author: author.length === 0 ? null : author,
    permalink: text(value['permalink']),
    createdAt: Math.max(0, integer(value['createdAt'])),
    openedHandled: value['openedHandled'] === true,
    bestAnswerCommentId: bestAnswer.length === 0 ? null : bestAnswer,
    updatedAt: Math.max(0, integer(value['updatedAt'])),
  };
};

const encodeQuestion = (value: QuestionStateRecord): JsonMap => ({
  submissionId: value.submissionId,
  subreddit: value.subreddit,
  title: value.title,
  summary: value.summary,
  author: value.author ?? '',
  permalink: value.permalink,
  createdAt: value.createdAt,
  openedHandled: value.openedHandled,
  bestAnswerCommentId: value.bestAnswerCommentId ?? '',
  updatedAt: value.updatedAt,
});

const validate = (input: QuestionStateInput): Omit<QuestionStateRecord, 'openedHandled' | 'bestAnswerCommentId' | 'updatedAt'> => {
  const submissionId = input.submissionId.trim();
  const subreddit = input.subreddit.trim();
  const permalink = input.permalink.trim();
  if (submissionId.length === 0) throw new Error('Question submission ID is required');
  if (subreddit.length === 0) throw new Error('Question subreddit is required');
  if (permalink.length === 0) throw new Error('Question permalink is required');
  if (!Number.isSafeInteger(input.createdAt) || input.createdAt < 0) {
    throw new Error('Question creation timestamp is invalid');
  }
  return {
    submissionId,
    subreddit,
    title: input.title.trim(),
    summary: input.summary?.trim() ?? '',
    author: input.author?.trim() || null,
    permalink,
    createdAt: input.createdAt,
  };
};

const mergeQuestion = (
  existing: QuestionStateRecord | null,
  input: QuestionStateInput,
  openedHandled: boolean,
): QuestionStateRecord => {
  const next = validate(input);
  if (existing === null) {
    return {
      ...next,
      openedHandled,
      bestAnswerCommentId: null,
      updatedAt: next.createdAt,
    };
  }
  return {
    ...existing,
    subreddit: existing.subreddit || next.subreddit,
    title: existing.title || next.title,
    summary: existing.summary || next.summary,
    author: existing.author ?? next.author,
    permalink: existing.permalink || next.permalink,
    createdAt: existing.createdAt > 0 ? existing.createdAt : next.createdAt,
    openedHandled: existing.openedHandled || openedHandled,
  };
};

export class QuestionStateStore {
  private readonly store: Store;

  public constructor(file = 'data/questionState.pb') {
    this.store = new Store(file, initial());
  }

  public async activated(subreddit: string): Promise<boolean> {
    const value = root(await this.store.read());
    return child(value, 'activated')[keyFor(subreddit)] === true;
  }

  public async bootstrap(
    subreddit: string,
    questions: readonly QuestionStateInput[],
    handledCommandIds: readonly string[],
  ): Promise<boolean> {
    const community = keyFor(subreddit);
    if (community.length === 0) throw new Error('Question bootstrap subreddit is required');
    let activated = false;
    await this.store.edit(current => {
      const value = root(current);
      const active = child(value, 'activated');
      if (active[community] === true) return value;

      const storedQuestions = child(value, 'questions');
      for (const input of questions) {
        const existing = decodeQuestion(storedQuestions[input.submissionId]);
        storedQuestions[input.submissionId] = encodeQuestion(mergeQuestion(existing, input, true));
      }

      const commands = child(value, 'commands');
      for (const id of handledCommandIds) {
        const key = id.trim();
        if (key.length > 0) commands[key] = 0;
      }
      active[community] = true;
      activated = true;
      return value;
    });
    return activated;
  }

  public async question(submissionId: string): Promise<QuestionStateRecord | null> {
    const value = root(await this.store.read());
    return decodeQuestion(child(value, 'questions')[submissionId]);
  }

  public async all(): Promise<readonly QuestionStateRecord[]> {
    const value = root(await this.store.read());
    return Object.values(child(value, 'questions'))
      .map(decodeQuestion)
      .filter((entry): entry is QuestionStateRecord => entry !== null)
      .sort((a, b) => a.createdAt - b.createdAt || a.submissionId.localeCompare(b.submissionId));
  }

  public async ensureQuestion(input: QuestionStateInput, openedHandled = false): Promise<QuestionStateRecord> {
    let out: QuestionStateRecord | null = null;
    await this.store.edit(current => {
      const value = root(current);
      const questions = child(value, 'questions');
      const existing = decodeQuestion(questions[input.submissionId]);
      const next = mergeQuestion(existing, input, openedHandled);
      questions[next.submissionId] = encodeQuestion(next);
      out = next;
      return value;
    });
    if (out === null) throw new Error('Failed to persist question state');
    return out;
  }

  public async markOpenedHandled(submissionId: string): Promise<QuestionStateRecord | null> {
    return await this.editQuestion(submissionId, current => ({ ...current, openedHandled: true }));
  }

  public async selectBestAnswer(
    submissionId: string,
    answerCommentId: string,
    at: number,
  ): Promise<QuestionStateRecord | null> {
    if (!Number.isSafeInteger(at) || at < 0) throw new Error('Best-answer timestamp is invalid');
    const id = answerCommentId.trim();
    if (id.length === 0) throw new Error('Best-answer comment ID is required');
    return await this.editQuestion(submissionId, current => ({
      ...current,
      bestAnswerCommentId: id,
      updatedAt: Math.max(current.updatedAt, at),
    }));
  }

  public async commandHandled(commentId: string): Promise<boolean> {
    const value = root(await this.store.read());
    return child(value, 'commands')[commentId] !== undefined;
  }

  public async markCommandHandled(commentId: string, at: number): Promise<void> {
    const id = commentId.trim();
    if (id.length === 0) throw new Error('Question command comment ID is required');
    if (!Number.isSafeInteger(at) || at < 0) throw new Error('Question command timestamp is invalid');
    await this.store.edit(current => {
      const value = root(current);
      child(value, 'commands')[id] = at;
      return value;
    });
  }

  private async editQuestion(
    submissionId: string,
    update: (current: QuestionStateRecord) => QuestionStateRecord,
  ): Promise<QuestionStateRecord | null> {
    let out: QuestionStateRecord | null = null;
    await this.store.edit(current => {
      const value = root(current);
      const questions = child(value, 'questions');
      const existing = decodeQuestion(questions[submissionId]);
      if (existing === null) return value;
      const next = update(existing);
      questions[submissionId] = encodeQuestion(next);
      out = next;
      return value;
    });
    return out;
  }
}
