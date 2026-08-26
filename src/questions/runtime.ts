import { command } from '../community/commands.ts';
import type { RedditReadClient } from '../reddit/client.ts';
import type { RedditComment, RedditPost } from '../reddit/types.ts';
import { QuestionEventStore } from './events.ts';
import { QuestionStateStore, type QuestionStateInput, type QuestionStateRecord } from './state.ts';

export type QuestionRuntimeReader = Pick<RedditReadClient, 'newPosts' | 'newComments' | 'moderators'>;

export type QuestionTickResult = {
  readonly activated: number;
  readonly seeded: number;
  readonly opened: number;
  readonly resolved: number;
  readonly ignored: number;
  readonly failed: number;
};

type ModeratorSnapshot = {
  readonly until: number;
  readonly users: ReadonlySet<string>;
};

const normal = (value: string): string => value.trim().toLowerCase();
const questionFlair = (value: string | null): boolean => normal(value ?? '') === 'question';
const submissionId = (fullname: string): string | null => {
  const match = fullname.match(/^t3_([A-Za-z0-9]+)$/u);
  return match?.[1] ?? null;
};
const answerId = (fullname: string | null): string | null => {
  const match = fullname?.match(/^t1_([A-Za-z0-9]+)$/u) ?? null;
  return match?.[1] ?? null;
};

const nativeQuestion = (post: RedditPost): boolean =>
  post.crosspostParent === null && questionFlair(post.flairText);

const questionFromPost = (post: RedditPost): QuestionStateInput => ({
  submissionId: post.id,
  subreddit: post.subreddit,
  title: post.title,
  author: post.author,
  permalink: post.permalink,
  createdAt: Math.max(0, Math.floor(post.createdUtc)),
});

const submissionPermalink = (comment: RedditComment): string => {
  if (comment.submissionPermalink !== null && comment.submissionPermalink.trim().length > 0) {
    return comment.submissionPermalink;
  }
  return comment.permalink.replace(new RegExp(`/${comment.id}/?$`, 'u'), '/');
};

const questionFromComment = (comment: RedditComment): QuestionStateInput | null => {
  const id = submissionId(comment.submissionFullname);
  if (id === null || !questionFlair(comment.submissionFlairText)) return null;
  const permalink = submissionPermalink(comment);
  if (permalink.trim().length === 0) return null;
  return {
    submissionId: id,
    subreddit: comment.subreddit,
    title: comment.submissionTitle ?? '',
    author: comment.submissionAuthor,
    permalink,
    createdAt: Math.max(0, Math.floor(comment.createdUtc)),
  };
};

const answerPermalink = (comment: RedditComment, parentId: string): string => {
  const own = new RegExp(`/${comment.id}/?$`, 'u');
  const replaced = comment.permalink.replace(own, `/${parentId}/`);
  return replaced === comment.permalink
    ? `${submissionPermalink(comment).replace(/\/$/u, '')}/${parentId}/`
    : replaced;
};

export class RedditQuestionRuntime {
  private readonly moderators = new Map<string, ModeratorSnapshot>();

  public constructor(
    private readonly communities: readonly string[],
    private readonly reader: QuestionRuntimeReader,
    private readonly state: QuestionStateStore,
    private readonly events: QuestionEventStore,
    private readonly moderatorTtlMs = 5 * 60_000,
  ) {
    if (communities.length === 0) throw new Error('Question runtime requires at least one subreddit');
    if (!Number.isSafeInteger(moderatorTtlMs) || moderatorTtlMs < 0) {
      throw new Error('Question moderator cache TTL must be a non-negative safe integer');
    }
  }

  public async tick(): Promise<QuestionTickResult> {
    const result = { activated: 0, seeded: 0, opened: 0, resolved: 0, ignored: 0, failed: 0 };
    for (const subreddit of this.communities) {
      const posts = await this.reader.newPosts(subreddit, 100);
      const comments = await this.reader.newComments(subreddit, 100);

      if (!await this.state.activated(subreddit)) {
        const questions = posts.filter(nativeQuestion).map(questionFromPost);
        const commands = comments.filter(value => command(value.body) === 'thankyou').map(value => value.id);
        if (await this.state.bootstrap(subreddit, questions, commands)) {
          result.activated += 1;
          result.seeded += questions.length;
        }
        continue;
      }

      const orderedPosts = [...posts].sort((a, b) => a.createdUtc - b.createdUtc || a.id.localeCompare(b.id));
      for (const post of orderedPosts) {
        if (!nativeQuestion(post)) continue;
        try {
          const stored = await this.state.ensureQuestion(questionFromPost(post));
          if (stored.openedHandled) continue;
          await this.events.opened({
            submissionId: stored.submissionId,
            subreddit: stored.subreddit,
            title: stored.title,
            submissionAuthor: stored.author ?? '',
            submissionPermalink: stored.permalink,
            at: stored.createdAt,
          });
          await this.state.markOpenedHandled(stored.submissionId);
          result.opened += 1;
        } catch {
          result.failed += 1;
        }
      }

      const orderedComments = [...comments].sort((a, b) => a.createdUtc - b.createdUtc || a.id.localeCompare(b.id));
      for (const comment of orderedComments) {
        if (command(comment.body) !== 'thankyou') continue;
        if (await this.state.commandHandled(comment.id)) continue;
        try {
          if (await this.resolve(comment)) result.resolved += 1;
          else result.ignored += 1;
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
    const parentId = answerId(comment.parentFullname);
    const id = submissionId(comment.submissionFullname);
    if (actor === null || parentId === null || id === null) return false;

    let question = await this.state.question(id);
    if (question === null) {
      const input = questionFromComment(comment);
      if (input === null) return false;
      question = await this.state.ensureQuestion(input, true);
    } else {
      const enriched = questionFromComment(comment);
      if (enriched !== null) question = await this.state.ensureQuestion(enriched, question.openedHandled);
    }

    if (!await this.canChoose(actor, question)) return false;

    await this.events.bestAnswer({
      submissionId: question.submissionId,
      subreddit: question.subreddit,
      title: question.title,
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

  private async canChoose(actor: string, question: QuestionStateRecord): Promise<boolean> {
    if (question.author !== null && normal(actor) === normal(question.author)) return true;
    const subreddit = normal(question.subreddit);
    const now = Date.now();
    let snapshot = this.moderators.get(subreddit) ?? null;
    if (snapshot === null || snapshot.until <= now) {
      const values = await this.reader.moderators(question.subreddit);
      snapshot = {
        until: now + this.moderatorTtlMs,
        users: new Set(values.map(value => normal(value.name))),
      };
      this.moderators.set(subreddit, snapshot);
    }
    return snapshot.users.has(normal(actor));
  }
}
