import {
  countVectorCosine,
  firstLegacySimilarQuestion,
  normaliseLegacyQuestion,
} from '../community/questions.ts';
import type { RedditModerationCfg } from '../env.ts';
import {
  RedditModerationClassifier,
  type ModerationClassification,
  type ModerationClassifier,
  type ModerationItem,
  type ModerationPostFlair,
} from '../mod/classifier.ts';
import { ensureQuestionAcknowledgement } from '../questions/acknowledgement.ts';
import type { QuestionEventStore } from '../questions/events.ts';
import { RepeatedQuestionStore } from '../questions/repeats.ts';
import type { QuestionStateStore } from '../questions/state.ts';
import type { ReputationStore } from '../reputation/store.ts';
import type { RedditReadClient } from '../reddit/client.ts';
import type { RedditMutationClient } from '../reddit/mutate.ts';
import type { RedditFlairTemplate } from '../reddit/types.ts';
import { Store } from '../store/store.ts';
import { isMap, type Json, type JsonMap } from '../types/json.ts';

export const REPEATED_QUESTION_FLAIR_TEXT = 'Repeated question :lisa:';

export type PostOrganisationReader = Pick<RedditReadClient, 'postFlairTemplates'>;
export type PostOrganisationWriter = Pick<
  RedditMutationClient,
  'setPostFlairTemplate' | 'sendPrivateMessage' | 'reply' | 'lock' | 'distinguish' | 'createFlairTemplate'
>;
export type PostOrganisationReputation = Pick<ReputationStore, 'hasContribution'>;

export type PostOrganisationPlan = {
  readonly fullname: string;
  readonly submissionId: string;
  readonly subreddit: string;
  readonly author: string;
  readonly permalink: string;
  readonly targetFlairTemplateId: string;
  readonly targetFlairText: string;
  readonly isQuestion: boolean;
  readonly questionTitle: string;
  readonly questionSummary: string;
  readonly createdAt: number;
  readonly applied: boolean;
};

const initial = (): JsonMap => ({ schema: 1, plans: {} });

const root = (value: Json): JsonMap => {
  if (!isMap(value) || value['schema'] !== 1) throw new Error('Unsupported post organisation store');
  if (!isMap(value['plans'])) value['plans'] = {};
  return value;
};

const text = (value: Json | undefined): string => typeof value === 'string' ? value : '';
const integer = (value: Json | undefined): number =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : 0;

const decodePlan = (value: Json | undefined): PostOrganisationPlan | null => {
  if (!isMap(value)) return null;
  const fullname = text(value['fullname']);
  const submissionId = text(value['submissionId']);
  const subreddit = text(value['subreddit']);
  const permalink = text(value['permalink']);
  const targetFlairTemplateId = text(value['targetFlairTemplateId']);
  if (
    fullname.length === 0
    || submissionId.length === 0
    || subreddit.length === 0
    || permalink.length === 0
    || targetFlairTemplateId.length === 0
  ) return null;
  return {
    fullname,
    submissionId,
    subreddit,
    author: text(value['author']),
    permalink,
    targetFlairTemplateId,
    targetFlairText: text(value['targetFlairText']),
    isQuestion: value['isQuestion'] === true,
    questionTitle: text(value['questionTitle']),
    questionSummary: text(value['questionSummary']),
    createdAt: Math.max(0, integer(value['createdAt'])),
    applied: value['applied'] === true,
  };
};

const encodePlan = (value: PostOrganisationPlan): JsonMap => ({
  fullname: value.fullname,
  submissionId: value.submissionId,
  subreddit: value.subreddit,
  author: value.author,
  permalink: value.permalink,
  targetFlairTemplateId: value.targetFlairTemplateId,
  targetFlairText: value.targetFlairText,
  isQuestion: value.isQuestion,
  questionTitle: value.questionTitle,
  questionSummary: value.questionSummary,
  createdAt: value.createdAt,
  applied: value.applied,
});

const submissionIdFromPermalink = (permalink: string): string | null => {
  const match = /\/comments\/([A-Za-z0-9]+)(?:\/|$)/iu.exec(permalink);
  return match?.[1] ?? null;
};

const questionFlair = (textValue: string): boolean => /^question(?:\s|$)/iu.test(textValue.trim());
const repeatedQuestionFlair = (textValue: string): boolean =>
  textValue.trim().toLowerCase() === REPEATED_QUESTION_FLAIR_TEXT.toLowerCase();
const absoluteRedditUrl = (permalink: string): string => /^https?:\/\//iu.test(permalink)
  ? permalink
  : `https://reddit.com${permalink.startsWith('/') ? '' : '/'}${permalink}`;

const repeatedFlairTemplate = (): RedditFlairTemplate => ({
  id: '',
  text: REPEATED_QUESTION_FLAIR_TEXT,
  cssClass: null,
  textColour: null,
  backgroundColour: null,
  modOnly: true,
  textEditable: false,
  allowableContent: 'all',
  maxEmojis: 1,
});

export const ensureRepeatedQuestionFlair = async (
  subreddit: string,
  reader: PostOrganisationReader,
  writer: Pick<RedditMutationClient, 'createFlairTemplate'>,
): Promise<RedditFlairTemplate> => {
  const before = await reader.postFlairTemplates(subreddit);
  const existing = before.find(value => repeatedQuestionFlair(value.text)) ?? null;
  if (existing !== null) return existing;

  await writer.createFlairTemplate(subreddit, 'post', repeatedFlairTemplate());
  const after = await reader.postFlairTemplates(subreddit);
  const created = after.find(value => repeatedQuestionFlair(value.text)) ?? null;
  if (created === null) {
    throw new Error(`r/${subreddit} did not expose ${REPEATED_QUESTION_FLAIR_TEXT} after creation`);
  }
  return created;
};

const duplicateComment = (
  subreddit: string,
  existingSubreddit: string,
  existingTitle: string,
  existingPermalink: string,
): string => [
  `This question in r/${subreddit} appears very similar to an earlier question in r/${existingSubreddit}:`,
  '',
  `**${existingTitle}**`,
  absoluteRedditUrl(existingPermalink),
  '',
  `I've temporarily marked this post as **${REPEATED_QUESTION_FLAIR_TEXT}** and locked it while our moderators review the match.`,
  '',
  'If this was flagged in error, a subreddit moderator can reply `!false` **directly to this comment**. Mae will then restore the Question, unlock it, remove this notice, and bypass this duplicate match.',
  '',
  '---',
  '^beep ^boop! ^I ^am ^a ^bot. ^This ^response ^is ^automated.',
].join('\n');

export class PostOrganisationStore {
  private readonly store: Store;

  public constructor(file = 'data/postOrganisation.pb') {
    this.store = new Store(file, initial());
  }

  public async plan(value: Omit<PostOrganisationPlan, 'applied'>): Promise<void> {
    await this.store.edit(current => {
      const state = root(current);
      const plans = state['plans'];
      if (!isMap(plans)) throw new Error('Post organisation plans map is invalid');
      const existing = decodePlan(plans[value.fullname]);
      if (existing?.applied === true) return state;
      plans[value.fullname] = encodePlan({ ...value, applied: false });
      return state;
    });
  }

  public async pending(): Promise<readonly PostOrganisationPlan[]> {
    const state = root(await this.store.read());
    const plans = state['plans'];
    if (!isMap(plans)) return [];
    return Object.values(plans)
      .map(decodePlan)
      .filter((value): value is PostOrganisationPlan => value !== null && !value.applied)
      .sort((a, b) => a.createdAt - b.createdAt || a.fullname.localeCompare(b.fullname));
  }

  public async markApplied(fullname: string): Promise<void> {
    await this.store.edit(current => {
      const state = root(current);
      const plans = state['plans'];
      if (!isMap(plans)) return state;
      const existing = decodePlan(plans[fullname]);
      if (existing !== null) plans[fullname] = encodePlan({ ...existing, applied: true });
      return state;
    });
  }
}

type FlairCache = {
  readonly until: number;
  readonly values: readonly ModerationPostFlair[];
};

export class OrganisingModerationClassifier implements ModerationClassifier {
  private readonly inner: ModerationClassifier;
  private readonly flairs = new Map<string, FlairCache>();

  public constructor(
    cfg: RedditModerationCfg,
    private readonly reader: PostOrganisationReader,
    private readonly plans: PostOrganisationStore,
    private readonly flairTtlMs = 5 * 60_000,
    classifier: ModerationClassifier | null = null,
  ) {
    this.inner = classifier ?? new RedditModerationClassifier(cfg.ai);
  }

  public async classify(item: ModerationItem): Promise<ModerationClassification> {
    if (item.kind !== 'post') return await this.inner.classify(item);

    const postFlairs = await this.flairInventory(item.subreddit);
    const classification = await this.inner.classify({ ...item, postFlairs });
    const organisation = classification.postOrganisation ?? null;
    if (classification.disposition !== 'allow' || organisation === null) return classification;

    const target = postFlairs.find(value => value.id === organisation.flairTemplateId) ?? null;
    if (target === null) throw new Error('Post organisation target flair disappeared from the live inventory');
    if (organisation.isQuestion !== questionFlair(target.text)) {
      throw new Error('Post organisation question classification disagrees with the selected flair');
    }

    const submissionId = submissionIdFromPermalink(item.permalink);
    if (submissionId === null) throw new Error(`Could not derive Reddit submission id from ${item.permalink}`);
    await this.plans.plan({
      fullname: `t3_${submissionId}`,
      submissionId,
      subreddit: item.subreddit,
      author: item.author === '[deleted]' ? '' : item.author,
      permalink: item.permalink,
      targetFlairTemplateId: target.id,
      targetFlairText: target.text,
      isQuestion: organisation.isQuestion,
      questionTitle: organisation.questionTitle,
      questionSummary: organisation.questionSummary,
      createdAt: Math.floor(Date.now() / 1_000),
    });
    return classification;
  }

  private async flairInventory(subreddit: string): Promise<readonly ModerationPostFlair[]> {
    const key = subreddit.trim().toLowerCase();
    const now = Date.now();
    const cached = this.flairs.get(key);
    if (cached !== undefined && cached.until > now) return cached.values;
    const templates = await this.reader.postFlairTemplates(subreddit);
    const values = templates
      .filter(value => !value.modOnly && !repeatedQuestionFlair(value.text))
      .map(value => ({ id: value.id, text: value.text }))
      .filter(value => value.id.trim().length > 0 && value.text.trim().length > 0);
    if (values.length === 0) throw new Error(`r/${subreddit} exposes no assignable post flair templates`);
    this.flairs.set(key, { until: now + this.flairTtlMs, values });
    return values;
  }
}

export type PostOrganisationTick = {
  readonly pending: number;
  readonly organised: number;
  readonly questions: number;
  readonly duplicates: number;
  readonly deferred: number;
  readonly failed: number;
};

export class PostOrganisationRuntime {
  public constructor(
    private readonly plans: PostOrganisationStore,
    private readonly reputation: PostOrganisationReputation,
    private readonly reader: PostOrganisationReader,
    private readonly writer: PostOrganisationWriter,
    private readonly questions: QuestionStateStore,
    private readonly events: QuestionEventStore,
    private readonly repeats: RepeatedQuestionStore,
  ) {}

  public async tick(): Promise<PostOrganisationTick> {
    const pending = await this.plans.pending();
    let organised = 0;
    let questions = 0;
    let duplicates = 0;
    let deferred = 0;
    let failed = 0;

    for (const plan of pending) {
      if (!await this.reputation.hasContribution(plan.fullname)) {
        deferred += 1;
        continue;
      }
      try {
        if (!plan.isQuestion) {
          await this.writer.setPostFlairTemplate(
            plan.subreddit,
            plan.submissionId,
            plan.targetFlairTemplateId,
            null,
          );
          organised += 1;
          await this.plans.markApplied(plan.fullname);
          continue;
        }

        if (await this.repeats.bypassed(plan.submissionId)) {
          const opened = await this.openQuestion(plan);
          organised += 1;
          questions += opened ? 1 : 0;
          await this.plans.markApplied(plan.fullname);
          continue;
        }

        const catalogue = (await this.questions.all())
          .filter(value => value.submissionId !== plan.submissionId);
        const previous = catalogue.map(value => ({
          submissionId: value.submissionId,
          normalisedTitle: normaliseLegacyQuestion(value.title),
        }));
        const duplicate = firstLegacySimilarQuestion(plan.questionTitle, previous);

        if (duplicate !== null) {
          const existing = catalogue.find(value => value.submissionId === duplicate.submissionId) ?? null;
          if (existing === null) throw new Error(`Duplicate catalogue entry ${duplicate.submissionId} disappeared`);
          const similarity = countVectorCosine(
            normaliseLegacyQuestion(plan.questionTitle),
            duplicate.normalisedTitle,
          );
          await this.flagRepeatedQuestion(plan, existing, similarity);
          organised += 1;
          duplicates += 1;
        } else {
          const opened = await this.openQuestion(plan);
          organised += 1;
          questions += opened ? 1 : 0;
        }

        await this.plans.markApplied(plan.fullname);
      } catch (error) {
        failed += 1;
        console.error(`[Reddit organisation] ${plan.fullname} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { pending: pending.length, organised, questions, duplicates, deferred, failed };
  }

  private async openQuestion(plan: PostOrganisationPlan): Promise<boolean> {
    await this.writer.setPostFlairTemplate(
      plan.subreddit,
      plan.submissionId,
      plan.targetFlairTemplateId,
      null,
    );
    let stored = await this.questions.ensureQuestion({
      submissionId: plan.submissionId,
      subreddit: plan.subreddit,
      title: plan.questionTitle,
      summary: plan.questionSummary,
      author: plan.author || null,
      permalink: plan.permalink,
      createdAt: plan.createdAt,
    });
    stored = await ensureQuestionAcknowledgement(stored, this.questions, this.writer, plan.createdAt);
    if (stored.openedHandled) return false;
    await this.events.opened({
      submissionId: stored.submissionId,
      subreddit: stored.subreddit,
      title: stored.title,
      summary: stored.summary,
      submissionAuthor: stored.author ?? '',
      submissionPermalink: stored.permalink,
      at: stored.createdAt,
    });
    await this.questions.markOpenedHandled(stored.submissionId);
    return true;
  }

  private async flagRepeatedQuestion(
    plan: PostOrganisationPlan,
    existing: Awaited<ReturnType<QuestionStateStore['question']>> & {},
    similarity: number,
  ): Promise<void> {
    const prior = await this.repeats.question(plan.submissionId);
    const repeatedFlair = prior === null
      ? await ensureRepeatedQuestionFlair(plan.subreddit, this.reader, this.writer)
      : {
          id: prior.repeatedFlairTemplateId,
          text: REPEATED_QUESTION_FLAIR_TEXT,
        };
    if (repeatedFlair.id.trim().length === 0) throw new Error('Repeated question flair template ID is missing');

    let review = await this.repeats.ensure({
      submissionId: plan.submissionId,
      subreddit: plan.subreddit,
      author: plan.author || null,
      permalink: plan.permalink,
      title: plan.questionTitle,
      summary: plan.questionSummary,
      questionFlairTemplateId: plan.targetFlairTemplateId,
      questionFlairText: plan.targetFlairText,
      repeatedFlairTemplateId: repeatedFlair.id,
      matchedSubmissionId: existing.submissionId,
      matchedSubreddit: existing.subreddit,
      matchedTitle: existing.title,
      matchedPermalink: existing.permalink,
      similarity,
      createdAt: plan.createdAt,
    });

    if (review.status === 'overturned') {
      await this.openQuestion(plan);
      return;
    }

    if (!review.flairApplied) {
      await this.writer.setPostFlairTemplate(plan.subreddit, plan.submissionId, review.repeatedFlairTemplateId, null);
      review = await this.requireRepeat(await this.repeats.markFlairApplied(plan.submissionId), plan.submissionId);
    }

    if (review.duplicateCommentId === null) {
      const created = await this.writer.reply(
        `t3_${plan.submissionId}`,
        duplicateComment(plan.subreddit, existing.subreddit, existing.title, existing.permalink),
      );
      review = await this.requireRepeat(
        await this.repeats.setDuplicateComment(plan.submissionId, created.id, created.permalink),
        plan.submissionId,
      );
      try {
        await this.writer.distinguish(created.fullname, false);
      } catch (error) {
        console.error(
          `[Reddit organisation] could not distinguish repeated-question notice ${created.fullname}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (!review.locked) {
      await this.writer.lock(`t3_${plan.submissionId}`);
      review = await this.requireRepeat(await this.repeats.markLocked(plan.submissionId), plan.submissionId);
    }

    if (!review.pmSent) {
      if (plan.author.length > 0) {
        await this.writer.sendPrivateMessage(
          plan.author,
          'Mae found a similar Reddit question',
          `Your question in r/${plan.subreddit} looks very similar to an earlier question in r/${existing.subreddit}:\n\n${existing.title}\n${absoluteRedditUrl(existing.permalink)}\n\nI've temporarily marked and locked your post while our moderators review whether it is a repeat.`,
        );
      }
      review = await this.requireRepeat(await this.repeats.markPmSent(plan.submissionId), plan.submissionId);
    }

    if (!review.reviewEventSent) {
      if (review.duplicateCommentPermalink === null) throw new Error('Repeated question review comment permalink is missing');
      await this.events.repeatReview({
        submissionId: plan.submissionId,
        subreddit: plan.subreddit,
        title: plan.questionTitle,
        summary: plan.questionSummary,
        submissionAuthor: plan.author,
        submissionPermalink: plan.permalink,
        matchedSubmissionId: existing.submissionId,
        matchedSubreddit: existing.subreddit,
        matchedTitle: existing.title,
        matchedPermalink: existing.permalink,
        similarity,
        reviewCommentPermalink: review.duplicateCommentPermalink,
        at: plan.createdAt,
      });
      await this.repeats.markReviewEventSent(plan.submissionId);
    }
  }

  private async requireRepeat<T>(value: T | null, submissionId: string): Promise<T> {
    if (value === null) throw new Error(`Repeated question ${submissionId} disappeared from durable state`);
    return value;
  }
}
