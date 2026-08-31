import {
  number,
  object,
  openaiSchema,
  shape,
  string,
  type OpenAISchema,
} from '../../vendor/openai-schema/src/openaiSchema.ts';
import type {
  ModerationAiCfg,
  ModerationClassification,
} from '../mod/classifier.ts';
import type { RedditComment } from '../reddit/types.ts';
import type { MemberModNoteLabel } from './store.ts';

export type MemberCommentAssessment = {
  readonly comment: RedditComment;
  readonly classification: ModerationClassification;
};

export type MemberActivityAssessment = {
  readonly fullname: string;
  readonly kind: 'post' | 'comment';
  readonly subreddit: string;
  readonly text: string;
  readonly classification: ModerationClassification;
};

export type MemberContributionAssessment = {
  readonly summary: string;
  readonly label: MemberModNoteLabel;
  readonly confidence: number;
};

export type ExistingMemberContributionAssessment = {
  readonly summary: string | null;
  readonly label: MemberModNoteLabel | null;
};

const labels: readonly MemberModNoteLabel[] = [
  'NONE',
  'HELPFUL_USER',
  'SOLID_CONTRIBUTOR',
  'SPAM_WATCH',
  'SPAM_WARNING',
  'ABUSE_WARNING',
] as const;

const assessmentShape = shape<MemberContributionAssessment>('MaeRedditMemberModNote', object({
  summary: string(),
  label: string(labels),
  confidence: number(),
}));

export const memberAssessmentInstructions = `You are Mae's member-contribution summariser for the Catgirl Coin Reddit communities.
You are given one Reddit member's recent comments from the moderated communities only, together with Mae's semantic moderation classification for each comment.
Return only the requested structured output.

Write a concise moderator-facing summary of how the member contributes to the communities. Base it only on the supplied comments. Describe observable contribution patterns such as helpfulness, constructive discussion, questions, humour, repetitive promotion, spam, hostility or abuse. Do not infer identity, demographics, health, politics, religion, sexuality, private circumstances or anything not directly established by the supplied comments.

Select exactly one Reddit Mod Note label:
- NONE: no strong positive or negative pattern, mixed/insufficient evidence, or ordinary participation.
- HELPFUL_USER: the sample shows a clearly helpful user who answers questions, assists others or provides useful information.
- SOLID_CONTRIBUTOR: the sample shows consistently constructive, good-faith community participation even if it is not primarily direct help.
- SPAM_WATCH: there is a mild or uncertain repetitive/promotional/spam concern worth watching, but not enough evidence for a warning.
- SPAM_WARNING: the sample shows clear repeated spam, unwanted promotion or substantially repetitive low-value posting.
- ABUSE_WARNING: the sample shows clear repeated abusive, harassing or seriously hostile conduct.

Do not choose a warning label merely because Mae classified one comment as low or severe. Judge the user's overall recent pattern and reserve warning labels for clear evidence. Do not label fair criticism, scepticism, disagreement or negative opinions as abuse or spam.

The summary must be one compact sentence, no more than 170 characters, with no username and no score. Confidence must be from 0 to 1.`;

export const memberUpdateInstructions = `You are Mae's incremental member-contribution summariser for the Catgirl Coin Reddit communities.
You are given the member's existing moderator summary/label plus exactly one new post or comment and Mae's semantic moderation classification for that new activity.
Return an UPDATED summary and label. Do not rebuild the member from scratch and do not forget established context merely because the newest interaction is different.

Treat the existing summary and label as compressed accumulated context. Integrate the new activity proportionately. Preserve established patterns unless the new evidence genuinely changes them. A single clean interaction should not erase a well-established abuse/spam pattern, and a single low-level violation should not manufacture a warning label where no pattern exists.

Fair criticism, scepticism, disappointment, sarcasm, investment losses, project-directed profanity, ordinary cryptocurrency comparisons, exchange/network discussion and first-party Nya/Catgirl ecosystem discussion are not abuse or spam by themselves. Follow the supplied moderation classification for the new activity rather than inventing a stricter interpretation.

Labels:
- NONE: no strong pattern, mixed/insufficient evidence, or ordinary participation.
- HELPFUL_USER: clearly helpful participation.
- SOLID_CONTRIBUTOR: consistently constructive good-faith participation.
- SPAM_WATCH: mild/uncertain repeated promotion or spam concern.
- SPAM_WARNING: clear repeated spam or unwanted promotion.
- ABUSE_WARNING: clear repeated abusive, harassing or seriously hostile conduct.

The summary must be one compact moderator-facing sentence, no more than 170 characters, with no username and no score. Do not infer sensitive/private traits. Confidence must be from 0 to 1.`;

const checked = (value: MemberContributionAssessment): MemberContributionAssessment => {
  if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    throw new Error('Member contribution assessment confidence must be from 0 to 1');
  }
  const summary = value.summary.trim().replace(/\s+/gu, ' ').slice(0, 170);
  if (summary.length === 0) throw new Error('Member contribution assessment summary cannot be empty');
  return { ...value, summary };
};

const inputFor = (
  username: string,
  comments: readonly MemberCommentAssessment[],
): readonly object[] => [{
  role: 'user',
  content: [{
    type: 'input_text',
    text: JSON.stringify({
      source: 'reddit',
      username,
      comments: comments.map(({ comment, classification }) => ({
        subreddit: comment.subreddit,
        body: comment.body,
        createdUtc: comment.createdUtc,
        redditScore: comment.score,
        permalink: comment.permalink,
        moderation: {
          verdict: classification.verdict,
          rule: classification.rule,
          disposition: classification.disposition,
          penaltyPoints: classification.penaltyPoints,
          reason: classification.reason,
        },
      })),
    }),
  }],
}];

const updateInputFor = (
  username: string,
  existing: ExistingMemberContributionAssessment,
  activity: MemberActivityAssessment,
): readonly object[] => [{
  role: 'user',
  content: [{
    type: 'input_text',
    text: JSON.stringify({
      source: 'reddit',
      username,
      existing: {
        summary: existing.summary,
        label: existing.label,
      },
      newActivity: {
        fullname: activity.fullname,
        kind: activity.kind,
        subreddit: activity.subreddit,
        text: activity.text,
        moderation: {
          verdict: activity.classification.verdict,
          rule: activity.classification.rule,
          disposition: activity.classification.disposition,
          penaltyPoints: activity.classification.penaltyPoints,
          reason: activity.classification.reason,
          evidence: activity.classification.evidence,
        },
      },
    }),
  }],
}];

export class MemberContributionAssessor {
  private readonly api: OpenAISchema<MemberContributionAssessment>;

  public constructor(private readonly cfg: ModerationAiCfg) {
    this.api = openaiSchema<MemberContributionAssessment>(
      cfg.key,
      assessmentShape,
      undefined,
      { conversation: false },
    );
  }

  public async assess(
    username: string,
    comments: readonly MemberCommentAssessment[],
  ): Promise<MemberContributionAssessment> {
    if (comments.length === 0) {
      return {
        summary: 'No recent comments were found in the moderated communities.',
        label: 'NONE',
        confidence: 1,
      };
    }
    const value = await this.api.run(assessmentShape, inputFor(username, comments), {
      retries: 1,
      body: {
        model: this.cfg.model,
        instructions: memberAssessmentInstructions,
        reasoning: { effort: this.cfg.effort },
      },
    });
    return checked(value);
  }

  public async update(
    username: string,
    existing: ExistingMemberContributionAssessment,
    activity: MemberActivityAssessment,
  ): Promise<MemberContributionAssessment> {
    const value = await this.api.run(assessmentShape, updateInputFor(username, existing, activity), {
      retries: 1,
      body: {
        model: this.cfg.model,
        instructions: memberUpdateInstructions,
        reasoning: { effort: this.cfg.effort },
      },
    });
    return checked(value);
  }
}

export const memberModNoteText = (points: number, summary: string): string => {
  if (!Number.isSafeInteger(points)) throw new Error('Member mod-note score must be a safe integer');
  const prefix = `Mae score: ${points}. `;
  const clean = summary.trim().replace(/\s+/gu, ' ');
  if (prefix.length >= 250) throw new Error('Member mod-note score prefix exceeds Reddit note limit');
  return `${prefix}${clean.slice(0, 250 - prefix.length)}`;
};
