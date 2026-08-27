import { command } from '../community/commands.ts';
import type { RedditReadClient } from '../reddit/client.ts';
import type { RedditMutationClient } from '../reddit/mutate.ts';
import type { RedditComment } from '../reddit/types.ts';
import { ensureQuestionAcknowledgement } from './acknowledgement.ts';
import { QuestionEventStore } from './events.ts';
import { RepeatedQuestionStore, type RepeatedQuestionRecord } from './repeats.ts';
import { QuestionStateStore, type QuestionStateRecord } from './state.ts';

export type QuestionRuntimeReader = Pick<RedditReadClient, 'newComments' | 'moderators'>;
export type QuestionRuntimeWriter = Pick<
  RedditMutationClient,
  'setPostFlairTemplate' | 'unlock' | 'deleteContent' | 'sendPrivateMessage' | 'reply' | 'distinguish'
>;

export type QuestionTickResult = {
  readonly activated: number;
  readonly seeded: number;
  readonly opened: number;
  readonly resolved: number;
  readonly repeatOverrides: number;
  readonly ignored: number;
  readonly failed: number;
};

type ModeratorSnapshot = {
  readonly until: number;
  readonly users: ReadonlySet<string>;
};

const normal = (value: string): string => value.trim().toLowerCase();
const submissionId = (fullname: string): string | null => {
  const match = fullname.match(/^t3_([A-Za-z0-9]+)$/u);
  return match?.[1] ?? null;
};
const commentId = (fullname: string | null | undefined): string | null => {
  const match = fullname?.match(/^t1_([A-Za-z0-9]+)$/u) ?? null;
  return match?.[1] ?? null;
};

const submissionPermalink = (comment: RedditComment): string => {
  const canonical = comment.submissionPermalink?.trim();
  if (canonical !== undefined && canonical.length > 0) return canonical;
  return comment.permalink.replace(new RegExp(`/${comment.id}/?$`, 'u'), '/');
};

const answerPermalink = (comment: RedditComment, parentId: string): string => {
  const own = new RegExp(`/${comment.id}/?$`, 'u');
  const replaced = comment.permalink.replace(own, `/${parentId}/`);
  return replaced === comment.permalink
    ? `${submissionPermalink(comment).replace(/\/$/u, '')}/${parentId}/`
    : replaced;
};

const apology = 'Apologies, after reviewing, our Moderators found the question was indeed not a repeat!';

export class RedditQuestionRuntime {
  private readonly moderators = new Map<string, ModeratorSnapshot>();

  public constructor(
    private readonly communities: readonly string[],
    private readonly reader: QuestionRuntimeReader,
    private readonly state: QuestionStateStore,
    private readonly events: QuestionEventStore,
    private readonly moderatorTtlMs = 5 * 60_000,
    private readonly repeats: RepeatedQuestionStore | null = null,
    private readonly writer: QuestionRuntimeWriter | null = null,
  ) {
    if (communities.length === 0) throw new Error('Question runtime requires at least one subreddit');
    if (!Number.isSafeInteger(moderatorTtlMs) || moderatorTtlMs < 0) {
      throw new Error('Question moderator cache TTL must be a non-negative safe integer');
    }
  }

  public async tick(): Promise<QuestionTickResult> {
    const result = {
      activated: 0,
      seeded: 0,
      opened: 0,
      resolved: 0,
      repeatOverrides: 0,
      ignored: 0,
      failed: 0,
    };
    for (const subreddit of this.communities) {
      const comments = await this.reader.newComments(subreddit, 100);

      if (!await this.state.activated(subreddit)) {
        const commands = comments
          .filter(value => {
            const parsed = command(value.body);
            return parsed === 'thankyou' || parsed === 'false';
          })
          .map(value => value.id);
        if (await this.state.bootstrap(subreddit, [], commands)) result.activated += 1;
        continue;
      }

      const orderedComments = [...comments].sort((a, b) => a.createdUtc - b.createdUtc || a.id.localeCompare(b.id));
      for (const comment of orderedComments) {
        const parsed = command(comment.body);
        if (parsed !== 'thankyou' && parsed !== 'false') continue;
        if (await this.state.commandHandled(comment.id)) continue;
        try {
          let handled = false;
          if (parsed === 'thankyou') {
            handled = await this.resolve(comment);
            if (handled) result.resolved += 1;
          } else {
            handled = await this.overrideRepeat(comment);
            if (handled) result.repeatOverrides += 1;
          }
          if (!handled) result.ignored += 1;
          await this.state.markCommandHandled(comment.id, Math.max(0, Math.floor(comment.createdUtc)));
        } catch {
          result.failed += 1;
        }
      }
    }
    return result;
  }

  private async resolve(comment: RedditComment): Promise<boolean> {
    const actor = comment.author;
    const parentId = commentId(comment.parentFullname);
    const id = submissionId(comment.submissionFullname);
    if (actor === null || parentId === null || id === null) return false;

    // QuestionStateStore is authoritative. A Reddit flair or a !thankyou command
    // can never manufacture a question that did not pass moderation + semantic
    // organisation first.
    const question = await this.state.question(id);
    if (question === null) return false;
    if (!await this.canChoose(actor, question)) return false;

    await this.events.bestAnswer({
      submissionId: question.submissionId,
      subreddit: question.subreddit,
      title: question.title,
      summary: question.summary,
      submissionAuthor: question.author ?? '',
      submissionPermalink: question.permalink,
      selectionCommentId: comment.id,
      answerCommentId: parentId,
      answerAuthor: null,
      answerPermalink: answerPermalink(comment, parentId),
      at: Math.max(0, Math.floor(comment.createdUtc)),
    });
    await this.state.selectBestAnswer(question.submissionId, parentId, Math.max(0, Math.floor(comment.createdUtc)));
    return true;
  }

  private async overrideRepeat(comment: RedditComment): Promise<boolean> {
    if (this.repeats === null || this.writer === null) return false;
    const actor = comment.author;
    const parentId = commentId(comment.parentFullname);
    const id = submissionId(comment.submissionFullname);
    if (actor === null || parentId === null || id === null) return false;

    let repeat = await this.repeats.byDuplicateComment(parentId);
    if (repeat === null || repeat.submissionId !== id || normal(repeat.subreddit) !== normal(comment.subreddit)) return false;

    if (repeat.status === 'pending') {
      if (!await this.isModerator(actor, repeat.subreddit)) return false;
      repeat = await this.requireRepeat(
        await this.repeats.acceptFalse(
          repeat.submissionId,
          comment.id,
          actor,
          Math.max(0, Math.floor(comment.createdUtc)),
        ),
        repeat.submissionId,
      );
    } else if (repeat.falseCommandId !== comment.id) {
      return false;
    }

    await this.restoreRepeat(repeat);
    return true;
  }

  private async restoreRepeat(input: RepeatedQuestionRecord): Promise<void> {
    if (this.repeats === null || this.writer === null) throw new Error('Repeated question restoration is not configured');
    let repeat = input;

    if (!repeat.questionFlairRestored) {
      await this.writer.setPostFlairTemplate(
        repeat.subreddit,
        repeat.submissionId,
        repeat.questionFlairTemplateId,
        null,
      );
      repeat = await this.requireRepeat(
        await this.repeats.markQuestionFlairRestored(repeat.submissionId),
        repeat.submissionId,
      );
    }

    if (!repeat.unlocked) {
      await this.writer.unlock(`t3_${repeat.submissionId}`);
      repeat = await this.requireRepeat(await this.repeats.markUnlocked(repeat.submissionId), repeat.submissionId);
    }

    if (!repeat.duplicateCommentDeleted) {
      if (repeat.duplicateCommentId === null) throw new Error('Repeated question Mae notice comment ID is missing');
      await this.writer.deleteContent(`t1_${repeat.duplicateCommentId}`);
      repeat = await this.requireRepeat(
        await this.repeats.markDuplicateCommentDeleted(repeat.submissionId),
        repeat.submissionId,
      );
    }

    if (!repeat.apologySent) {
      if (repeat.author !== null) {
        await this.writer.sendPrivateMessage(repeat.author, 'Mae repeat review', apology);
      }
      repeat = await this.requireRepeat(await this.repeats.markApologySent(repeat.submissionId), repeat.submissionId);
    }

    let question = await this.state.ensureQuestion({
      submissionId: repeat.submissionId,
      subreddit: repeat.subreddit,
      title: repeat.title,
      summary: repeat.summary,
      author: repeat.author,
      permalink: repeat.permalink,
      createdAt: repeat.createdAt,
    });
    question = await ensureQuestionAcknowledgement(question, this.state, this.writer, repeat.reviewedAt ?? repeat.createdAt);

    if (!question.openedHandled) {
      await this.events.opened({
        submissionId: question.submissionId,
        subreddit: question.subreddit,
        title: question.title,
        summary: question.summary,
        submissionAuthor: question.author ?? '',
        submissionPermalink: question.permalink,
        at: repeat.reviewedAt ?? question.createdAt,
      });
      await this.state.markOpenedHandled(question.submissionId);
    }
    if (!repeat.questionOpened) await this.repeats.markQuestionOpened(repeat.submissionId);
  }

  private async canChoose(actor: string, question: QuestionStateRecord): Promise<boolean> {
    if (question.author !== null && normal(actor) === normal(question.author)) return true;
    return await this.isModerator(actor, question.subreddit);
  }

  private async isModerator(actor: string, subreddit: string): Promise<boolean> {
    const key = normal(subreddit);
    const now = Date.now();
    let snapshot = this.moderators.get(key) ?? null;
    if (snapshot === null || snapshot.until <= now) {
      const values = await this.reader.moderators(subreddit);
      snapshot = {
        until: now + this.moderatorTtlMs,
        users: new Set(values.map(value => normal(value.name))),
      };
      this.moderators.set(key, snapshot);
    }
    return snapshot.users.has(normal(actor));
  }

  private async requireRepeat<T>(value: T | null, submissionIdValue: string): Promise<T> {
    if (value === null) throw new Error(`Repeated question ${submissionIdValue} disappeared from durable state`);
    return value;
  }
}
