import { Store } from '../store/store.ts';
import { isMap, type Json, type JsonMap } from '../types/json.ts';

export type RepeatedQuestionStatus = 'pending' | 'overturned';

export type RepeatedQuestionInput = {
  readonly submissionId: string;
  readonly subreddit: string;
  readonly author: string | null;
  readonly permalink: string;
  readonly title: string;
  readonly summary: string;
  readonly questionFlairTemplateId: string;
  readonly questionFlairText: string;
  readonly repeatedFlairTemplateId: string;
  readonly matchedSubmissionId: string;
  readonly matchedSubreddit: string;
  readonly matchedTitle: string;
  readonly matchedPermalink: string;
  readonly similarity: number;
  readonly createdAt: number;
};

export type RepeatedQuestionRecord = RepeatedQuestionInput & {
  readonly status: RepeatedQuestionStatus;
  readonly duplicateCommentId: string | null;
  readonly duplicateCommentPermalink: string | null;
  readonly flairApplied: boolean;
  readonly locked: boolean;
  readonly pmSent: boolean;
  readonly reviewEventSent: boolean;
  readonly falseCommandId: string | null;
  readonly reviewedBy: string | null;
  readonly reviewedAt: number | null;
  readonly questionFlairRestored: boolean;
  readonly unlocked: boolean;
  readonly duplicateCommentDeleted: boolean;
  readonly apologySent: boolean;
  readonly questionOpened: boolean;
};

const initial = (): JsonMap => ({ schema: 1, repeats: {} });

const root = (value: Json): JsonMap => {
  if (!isMap(value) || value['schema'] !== 1) throw new Error('Unsupported repeated question store');
  if (!isMap(value['repeats'])) value['repeats'] = {};
  return value;
};

const text = (value: Json | undefined): string => typeof value === 'string' ? value : '';
const integer = (value: Json | undefined): number =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : 0;
const number = (value: Json | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const decode = (value: Json | undefined): RepeatedQuestionRecord | null => {
  if (!isMap(value)) return null;
  const submissionId = text(value['submissionId']);
  const subreddit = text(value['subreddit']);
  const permalink = text(value['permalink']);
  const matchedSubmissionId = text(value['matchedSubmissionId']);
  const matchedSubreddit = text(value['matchedSubreddit']);
  const matchedPermalink = text(value['matchedPermalink']);
  if (
    submissionId.length === 0
    || subreddit.length === 0
    || permalink.length === 0
    || matchedSubmissionId.length === 0
    || matchedSubreddit.length === 0
    || matchedPermalink.length === 0
  ) return null;
  const author = text(value['author']);
  const duplicateCommentId = text(value['duplicateCommentId']);
  const duplicateCommentPermalink = text(value['duplicateCommentPermalink']);
  const falseCommandId = text(value['falseCommandId']);
  const reviewedBy = text(value['reviewedBy']);
  const reviewedAt = integer(value['reviewedAt']);
  return {
    submissionId,
    subreddit,
    author: author.length === 0 ? null : author,
    permalink,
    title: text(value['title']),
    summary: text(value['summary']),
    questionFlairTemplateId: text(value['questionFlairTemplateId']),
    questionFlairText: text(value['questionFlairText']),
    repeatedFlairTemplateId: text(value['repeatedFlairTemplateId']),
    matchedSubmissionId,
    matchedSubreddit,
    matchedTitle: text(value['matchedTitle']),
    matchedPermalink,
    similarity: Math.max(0, Math.min(1, number(value['similarity']))),
    createdAt: Math.max(0, integer(value['createdAt'])),
    status: value['status'] === 'overturned' ? 'overturned' : 'pending',
    duplicateCommentId: duplicateCommentId.length === 0 ? null : duplicateCommentId,
    duplicateCommentPermalink: duplicateCommentPermalink.length === 0 ? null : duplicateCommentPermalink,
    flairApplied: value['flairApplied'] === true,
    locked: value['locked'] === true,
    pmSent: value['pmSent'] === true,
    reviewEventSent: value['reviewEventSent'] === true,
    falseCommandId: falseCommandId.length === 0 ? null : falseCommandId,
    reviewedBy: reviewedBy.length === 0 ? null : reviewedBy,
    reviewedAt: reviewedAt > 0 ? reviewedAt : null,
    questionFlairRestored: value['questionFlairRestored'] === true,
    unlocked: value['unlocked'] === true,
    duplicateCommentDeleted: value['duplicateCommentDeleted'] === true,
    apologySent: value['apologySent'] === true,
    questionOpened: value['questionOpened'] === true,
  };
};

const encode = (value: RepeatedQuestionRecord): JsonMap => ({
  submissionId: value.submissionId,
  subreddit: value.subreddit,
  author: value.author ?? '',
  permalink: value.permalink,
  title: value.title,
  summary: value.summary,
  questionFlairTemplateId: value.questionFlairTemplateId,
  questionFlairText: value.questionFlairText,
  repeatedFlairTemplateId: value.repeatedFlairTemplateId,
  matchedSubmissionId: value.matchedSubmissionId,
  matchedSubreddit: value.matchedSubreddit,
  matchedTitle: value.matchedTitle,
  matchedPermalink: value.matchedPermalink,
  similarity: value.similarity,
  createdAt: value.createdAt,
  status: value.status,
  duplicateCommentId: value.duplicateCommentId ?? '',
  duplicateCommentPermalink: value.duplicateCommentPermalink ?? '',
  flairApplied: value.flairApplied,
  locked: value.locked,
  pmSent: value.pmSent,
  reviewEventSent: value.reviewEventSent,
  falseCommandId: value.falseCommandId ?? '',
  reviewedBy: value.reviewedBy ?? '',
  reviewedAt: value.reviewedAt ?? 0,
  questionFlairRestored: value.questionFlairRestored,
  unlocked: value.unlocked,
  duplicateCommentDeleted: value.duplicateCommentDeleted,
  apologySent: value.apologySent,
  questionOpened: value.questionOpened,
});

const validateInput = (input: RepeatedQuestionInput): RepeatedQuestionInput => {
  const submissionId = input.submissionId.trim();
  const subreddit = input.subreddit.trim();
  const permalink = input.permalink.trim();
  const matchedSubmissionId = input.matchedSubmissionId.trim();
  const matchedSubreddit = input.matchedSubreddit.trim();
  const matchedPermalink = input.matchedPermalink.trim();
  if (submissionId.length === 0) throw new Error('Repeated question submission ID is required');
  if (subreddit.length === 0) throw new Error('Repeated question subreddit is required');
  if (permalink.length === 0) throw new Error('Repeated question permalink is required');
  if (matchedSubmissionId.length === 0) throw new Error('Repeated question matched submission ID is required');
  if (matchedSubreddit.length === 0) throw new Error('Repeated question matched subreddit is required');
  if (matchedPermalink.length === 0) throw new Error('Repeated question matched permalink is required');
  if (!Number.isFinite(input.similarity) || input.similarity < 0 || input.similarity > 1) {
    throw new Error('Repeated question similarity is invalid');
  }
  if (!Number.isSafeInteger(input.createdAt) || input.createdAt < 0) {
    throw new Error('Repeated question creation timestamp is invalid');
  }
  return {
    ...input,
    submissionId,
    subreddit,
    author: input.author?.trim() || null,
    permalink,
    title: input.title.trim(),
    summary: input.summary.trim(),
    questionFlairTemplateId: input.questionFlairTemplateId.trim(),
    questionFlairText: input.questionFlairText.trim(),
    repeatedFlairTemplateId: input.repeatedFlairTemplateId.trim(),
    matchedSubmissionId,
    matchedSubreddit,
    matchedTitle: input.matchedTitle.trim(),
    matchedPermalink,
  };
};

const fresh = (input: RepeatedQuestionInput): RepeatedQuestionRecord => ({
  ...validateInput(input),
  status: 'pending',
  duplicateCommentId: null,
  duplicateCommentPermalink: null,
  flairApplied: false,
  locked: false,
  pmSent: false,
  reviewEventSent: false,
  falseCommandId: null,
  reviewedBy: null,
  reviewedAt: null,
  questionFlairRestored: false,
  unlocked: false,
  duplicateCommentDeleted: false,
  apologySent: false,
  questionOpened: false,
});

export class RepeatedQuestionStore {
  private readonly store: Store;

  public constructor(file = 'data/repeatedQuestions.pb') {
    this.store = new Store(file, initial());
  }

  public async ensure(input: RepeatedQuestionInput): Promise<RepeatedQuestionRecord> {
    let out: RepeatedQuestionRecord | null = null;
    await this.store.edit(current => {
      const value = root(current);
      const repeats = value['repeats'];
      if (!isMap(repeats)) throw new Error('Repeated question map is invalid');
      const existing = decode(repeats[input.submissionId]);
      if (existing !== null) {
        out = existing;
        return value;
      }
      const created = fresh(input);
      repeats[created.submissionId] = encode(created);
      out = created;
      return value;
    });
    if (out === null) throw new Error('Failed to persist repeated question');
    return out;
  }

  public async question(submissionId: string): Promise<RepeatedQuestionRecord | null> {
    const value = root(await this.store.read());
    const repeats = value['repeats'];
    return isMap(repeats) ? decode(repeats[submissionId]) : null;
  }

  public async byDuplicateComment(commentId: string): Promise<RepeatedQuestionRecord | null> {
    const id = commentId.trim();
    if (id.length === 0) return null;
    const value = root(await this.store.read());
    const repeats = value['repeats'];
    if (!isMap(repeats)) return null;
    return Object.values(repeats)
      .map(decode)
      .find(entry => entry?.duplicateCommentId === id) ?? null;
  }

  public async bypassed(submissionId: string): Promise<boolean> {
    return (await this.question(submissionId))?.status === 'overturned';
  }

  public async setDuplicateComment(
    submissionId: string,
    commentId: string,
    permalink: string,
  ): Promise<RepeatedQuestionRecord | null> {
    const id = commentId.trim();
    const link = permalink.trim();
    if (id.length === 0 || link.length === 0) throw new Error('Repeated question duplicate comment identity is required');
    return await this.edit(submissionId, current => ({
      ...current,
      duplicateCommentId: current.duplicateCommentId ?? id,
      duplicateCommentPermalink: current.duplicateCommentPermalink ?? link,
    }));
  }

  public async markFlairApplied(submissionId: string): Promise<RepeatedQuestionRecord | null> {
    return await this.edit(submissionId, current => ({ ...current, flairApplied: true }));
  }

  public async markLocked(submissionId: string): Promise<RepeatedQuestionRecord | null> {
    return await this.edit(submissionId, current => ({ ...current, locked: true }));
  }

  public async markPmSent(submissionId: string): Promise<RepeatedQuestionRecord | null> {
    return await this.edit(submissionId, current => ({ ...current, pmSent: true }));
  }

  public async markReviewEventSent(submissionId: string): Promise<RepeatedQuestionRecord | null> {
    return await this.edit(submissionId, current => ({ ...current, reviewEventSent: true }));
  }

  public async acceptFalse(
    submissionId: string,
    commandId: string,
    moderator: string,
    at: number,
  ): Promise<RepeatedQuestionRecord | null> {
    const id = commandId.trim();
    const actor = moderator.trim();
    if (id.length === 0 || actor.length === 0) throw new Error('Repeated question override identity is required');
    if (!Number.isSafeInteger(at) || at < 0) throw new Error('Repeated question override timestamp is invalid');
    return await this.edit(submissionId, current => ({
      ...current,
      status: 'overturned',
      falseCommandId: current.falseCommandId ?? id,
      reviewedBy: current.reviewedBy ?? actor,
      reviewedAt: current.reviewedAt ?? at,
    }));
  }

  public async markQuestionFlairRestored(submissionId: string): Promise<RepeatedQuestionRecord | null> {
    return await this.edit(submissionId, current => ({ ...current, questionFlairRestored: true }));
  }

  public async markUnlocked(submissionId: string): Promise<RepeatedQuestionRecord | null> {
    return await this.edit(submissionId, current => ({ ...current, unlocked: true }));
  }

  public async markDuplicateCommentDeleted(submissionId: string): Promise<RepeatedQuestionRecord | null> {
    return await this.edit(submissionId, current => ({ ...current, duplicateCommentDeleted: true }));
  }

  public async markApologySent(submissionId: string): Promise<RepeatedQuestionRecord | null> {
    return await this.edit(submissionId, current => ({ ...current, apologySent: true }));
  }

  public async markQuestionOpened(submissionId: string): Promise<RepeatedQuestionRecord | null> {
    return await this.edit(submissionId, current => ({ ...current, questionOpened: true }));
  }

  private async edit(
    submissionId: string,
    update: (current: RepeatedQuestionRecord) => RepeatedQuestionRecord,
  ): Promise<RepeatedQuestionRecord | null> {
    let out: RepeatedQuestionRecord | null = null;
    await this.store.edit(current => {
      const value = root(current);
      const repeats = value['repeats'];
      if (!isMap(repeats)) return value;
      const existing = decode(repeats[submissionId]);
      if (existing === null) return value;
      const next = update(existing);
      repeats[submissionId] = encode(next);
      out = next;
      return value;
    });
    return out;
  }
}
