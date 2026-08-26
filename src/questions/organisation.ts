import type { RedditModerationCfg } from '../env.ts';
import {
  RedditModerationClassifier,
  type ModerationClassification,
  type ModerationClassifier,
  type ModerationItem,
  type ModerationPostFlair,
} from '../mod/classifier.ts';
import type { ReputationStore } from '../reputation/store.ts';
import type { RedditReadClient } from '../reddit/client.ts';
import type { RedditMutationClient } from '../reddit/mutate.ts';
import { firstLegacySimilarQuestion } from '../community/questions.ts';
import { Store } from '../store/store.ts';
import { isMap, type Json, type JsonMap } from '../types/json.ts';
import type { QuestionEventStore } from './events.ts';
import type { QuestionStateStore } from './state.ts';

export type PostOrganisationReader = Pick<RedditReadClient, 'postFlairTemplates'>;
export type PostOrganisationWriter = Pick<RedditMutationClient, 'setPostFlairTemplate'>;

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
      if (!Object.hasOwn(plans, value.fullname)) plans[value.fullname] = encodePlan({ ...value, applied: false });
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
  private readonly inner: RedditModerationClassifier;
  private readonly flairs = new Map<string, FlairCache>();

  public constructor(
    cfg: RedditModerationCfg,
    private readonly reader: PostOrganisationReader,
    private readonly plans: PostOrganisationStore,
    private readonly flairTtlMs = 5 * 60_000,
  ) {
    this.inner = new RedditModerationClassifier(cfg.ai);
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
      .filter(value => !value.modOnly)
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
    private readonly reputation: ReputationStore,
    private readonly writer: PostOrganisationWriter,
    private readonly questions: QuestionStateStore,
    private readonly events: QuestionEventStore,
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
        await this.writer.setPostFlairTemplate(
          plan.subreddit,
          plan.submissionId,
          plan.targetFlairTemplateId,
          null,
        );
        organised += 1;

        if (plan.isQuestion) {
          const previous = (await this.questions.all())
            .filter(value => value.submissionId !== plan.submissionId)
            .map(value => ({
              submissionId: value.submissionId,
              normalisedTitle: value.title,
            }));
          const duplicate = firstLegacySimilarQuestion(plan.questionTitle, previous);
          if (duplicate !== null) {
            duplicates += 1;
          } else {
            const stored = await this.questions.ensureQuestion({
              submissionId: plan.submissionId,
              subreddit: plan.subreddit,
              title: plan.questionTitle,
              author: plan.author || null,
              permalink: plan.permalink,
              createdAt: plan.createdAt,
            });
            if (!stored.openedHandled) {
              const relayTitle = `${plan.questionTitle}\n${plan.questionSummary}`.trim();
              await this.events.opened({
                submissionId: stored.submissionId,
                subreddit: stored.subreddit,
                title: relayTitle,
                submissionAuthor: stored.author ?? '',
                submissionPermalink: stored.permalink,
                at: stored.createdAt,
              });
              await this.questions.markOpenedHandled(stored.submissionId);
              questions += 1;
            }
          }
        }
        await this.plans.markApplied(plan.fullname);
      } catch (error) {
        failed += 1;
        console.error(`[Reddit organisation] ${plan.fullname} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { pending: pending.length, organised, questions, duplicates, deferred, failed };
  }
}
