import {
  array,
  boolean,
  nullable,
  number,
  object,
  openaiSchema,
  shape,
  string,
  type OpenAISchema,
} from '../../vendor/openai-schema/src/openaiSchema.ts';
import type { ReputationStatus } from '../reputation/policy.ts';

export type ModerationVerdict = 'clean' | 'low' | 'severe' | 'scam';
export type ModerationRule = 'none' | 'rule_2' | 'rule_3' | 'rule_5' | 'rule_6' | 'reddit_site' | 'other';
export type ModerationDisposition = 'allow' | 'remove';

export type ModerationHistoryEntry = {
  readonly at: number;
  readonly verdict: ModerationVerdict;
  readonly rule: ModerationRule;
  readonly beforePoints: number;
  readonly afterPoints: number;
};

export type ModerationHistory = {
  readonly currentPoints: number;
  readonly currentStatus: ReputationStatus;
  readonly recentViolations: readonly ModerationHistoryEntry[];
};

export type ModerationPostFlair = {
  readonly id: string;
  readonly text: string;
};

export type ModerationPostOrganisation = {
  readonly flairTemplateId: string;
  readonly isQuestion: boolean;
  readonly questionTitle: string;
  readonly questionSummary: string;
  readonly confidence: number;
};

export type ModerationClassification = {
  readonly verdict: ModerationVerdict;
  readonly rule: ModerationRule;
  readonly disposition: ModerationDisposition;
  readonly penaltyPoints: number;
  readonly confidence: number;
  readonly reason: string;
  readonly evidence: readonly string[];
  readonly postOrganisation?: ModerationPostOrganisation | null;
};

export type ModerationItem = {
  readonly kind: 'post' | 'comment' | 'dm' | 'modmail';
  readonly subreddit: string;
  readonly author: string;
  readonly title: string;
  readonly text: string;
  readonly permalink: string;
  readonly mediaUrls: readonly string[];
  readonly history: ModerationHistory | null;
  readonly postFlairs?: readonly ModerationPostFlair[];
};

export type ModerationClassifier = {
  classify(item: ModerationItem): Promise<ModerationClassification>;
};

export type ConversationModerationClassifier = ModerationClassifier & {
  readonly conversationId: string | undefined;
};

export type ModerationAiCfg = {
  readonly key: string;
  readonly model: string;
  readonly effort: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
};

export type ModerationClassifierOptions = {
  readonly conversation?: boolean;
  readonly conversationId?: string;
};

const postOrganisationSchema = (item: ModerationItem) => nullable(object({
  flairTemplateId: item.postFlairs !== undefined && item.postFlairs.length > 0
    ? string(item.postFlairs.map(value => value.id))
    : string(),
  isQuestion: boolean(),
  questionTitle: string(),
  questionSummary: string(),
  confidence: number(),
}));

const classificationShape = (item: ModerationItem) => shape<ModerationClassification>('MaeRedditModeration', object({
  verdict: string(['clean', 'low', 'severe', 'scam']),
  rule: string(['none', 'rule_2', 'rule_3', 'rule_5', 'rule_6', 'reddit_site', 'other']),
  disposition: string(['allow', 'remove']),
  penaltyPoints: number(),
  confidence: number(),
  reason: string(),
  evidence: array(string(), 0, 6),
  postOrganisation: postOrganisationSchema(item),
}));

export const moderationInstructions = `You are Mae's deterministic semantic moderation and post-organisation classifier for the Catgirl Coin community.
Audit the supplied Reddit content against the actual community rules and return only the requested structured output.

The supplied history is authoritative context about this user's Mae reputation and recent rule violations. Use it only to calibrate the penalty of a genuine severe violation. Never turn ordinary criticism into a violation because the user has a bad history.

Moderation must be conservative about severe enforcement. A negative tone, sarcasm, an exchange name, a financial-loss statement, criticism of the project, or lack of supporting evidence is not by itself a severe violation. When content plausibly fits clean or low and the evidence for a removable violation is ambiguous, choose the less severe classification. Never infer malicious intent merely from negativity.

The important policy distinctions are:
- Fair criticism, scepticism, disappointment, questions, disagreement and negative opinions are allowed. Users are allowed to be unhappy with the project, token, price, developers, roadmap or their investment outcome.
- Sarcasm is allowed. Sarcasm does not become a violation merely because it mocks the price, project performance or the user's own investment loss.
- First-person reports of investment performance or loss are allowed, including angry, disappointed or sarcastic phrasing. Statements such as "I lost most of my money", "I went from $1000 to $4", "the price crashed hard", or "great investment lol" are not FUD merely because they are negative. Crypto users can genuinely lose money and are allowed to say so.
- Personal, needlessly hostile or non-constructive attacks directed at another person can be a LOW violation under Rule 2. LOW content stays visible: disposition=allow and penaltyPoints=1. Evaluate an insult separately from any otherwise allowed criticism or loss report in the same comment.
- Rule 6 FUD requires a materially false, fabricated, deceptive or manipulative accusation presented as fact. Examples include knowingly false claims that the project stole funds, rugged users, fabricated evidence of wrongdoing, or false accusations of criminal/scam conduct intended to mislead the community.
- Merely calling the project unsuccessful, dead, badly managed, disappointing, overpriced, a terrible investment, or expressing pessimism is not Rule 6. Negative opinion is allowed.
- Saying the project is a scam, or making factual accusations of fraud/theft/rugging/wrongdoing, can be Rule 6 when presented as a factual accusation without a legitimate basis in the supplied context. Distinguish opinion or uncertainty such as "this feels scammy" or "I'm worried this could be a scam" from a categorical factual accusation.
- If a factual claim cannot be verified or disproved from the supplied content/context, do not manufacture certainty. Do not classify it as severe merely because it lacks evidence. Severe Rule 6 requires strong evidence from the supplied content that the statement is materially false/deceptive or is clearly being used as manipulative misinformation.
- Harassment, direct bullying or personal hostility is Rule 2 unless it actually rises to harassment/hate/bigotry, which is Rule 3. Serious cases are SEVERE and removed.
- Mentioning, explaining, comparing, recommending the use of, or troubleshooting a legitimate cryptocurrency exchange is allowed. Exchange names, exchange links, listings, fees, transfer instructions and answers about where/how to buy Catgirl are not self-promotion and are not evidence of a scam by themselves.
- Rule 5 promotion requires an actual promotional call-to-action or vested promotion of another cryptocurrency/project, such as "buy my token", "join this presale", repeated shilling, referral solicitation, or directing users to a competing crypto for promotional purposes. Neutral or helpful exchange discussion does not qualify.
- verdict=SCAM requires concrete scam indicators such as phishing, wallet-draining instructions or links, seed/private-key requests, fake support/impersonation, fraudulent presales, malicious token promotion, or similarly deceptive theft/fraud behaviour. Never infer scam merely because a comment mentions an exchange, another service, a token, a link, or buying/selling crypto.
- Apply Reddit sitewide harassment/hate/threat rules when genuinely applicable, but do not stretch those labels to ordinary criticism.

Reputation penalty rules:
- clean: penaltyPoints=0.
- low: penaltyPoints=1.
- severe: penaltyPoints must be at least 10. Ten is the normal severe penalty. You may choose a larger integer when the event itself is exceptionally serious or the supplied history shows repeated/recent serious violations. The amount must be proportionate and explained in reason. Do not increase a penalty merely because the user's current score is low.
- scam: penaltyPoints=999999999. Deterministic code treats scam as immediate permanent enforcement, so use this verdict only when the supplied content itself contains strong concrete evidence of scam behaviour.

Post organisation is part of this SAME audit; never request or imply a second classification pass.
- For kind=post with disposition=allow and a non-empty postFlairs inventory, postOrganisation MUST be non-null.
- The supplied postFlairs are the actual assignable flair templates for that subreddit. Do not trust the flair the human happened to choose. Select the exact flairTemplateId whose meaning best describes the post's real purpose from its title, body and media.
- Humans are allowed to be messy. Categorise semantically rather than requiring tidy formatting or specific keywords.
- isQuestion=true when the post's substantive purpose is to ask the community for information, explanation, help, troubleshooting, advice or an answer. A question need not contain a question mark or begin with an interrogative word.
- If isQuestion=true, rewrite the underlying question as questionTitle: a concise, standalone, grammatically clear question ending in '?'. questionSummary must concisely summarise the context needed to answer it, without chatter, repetition, greetings or irrelevant narrative. Preserve materially important details and uncertainty; do not invent facts.
- If isQuestion=false, questionTitle and questionSummary MUST both be empty strings.
- For kind!=post, disposition=remove, or an empty postFlairs inventory, postOrganisation MUST be null.

Calibration examples:
- "Had no idea this was still alive tbh." => clean, penaltyPoints=0.
- "Catgirl is still a thing?" => clean, penaltyPoints=0.
- "I went from $1000 to about $4 in 4 years. Love it." => clean, penaltyPoints=0; sarcastic first-person loss report, not FUD.
- "This still going lol lost most of my money" => clean, penaltyPoints=0 unless there is a separate genuine violation.
- "I lost a lot at the 2021 peak and the price crashed hard" => clean, penaltyPoints=0.
- "Great project, turned my $1,000 into $4 lol" => clean, penaltyPoints=0; sarcasm and dissatisfaction are allowed.
- "The devs have handled this terribly" => clean, penaltyPoints=0 as criticism/opinion.
- A support/wallet complaint ending with a gratuitous personal insult directed at another user => low, Rule 2, allow, penaltyPoints=1.
- "You basement dwelling dweeb" directed at another user => low, Rule 2, allow, penaltyPoints=1 unless surrounding conduct genuinely establishes serious harassment.
- "You can buy Catgirl on Exchange X" or instructions for transferring Catgirl from an exchange to a wallet => clean, penaltyPoints=0.
- "Exchange X has lower fees than Exchange Y" => clean, penaltyPoints=0.
- "Buy my osamaSonicShitCoin, join the presale here" => Rule 5 promotion; classify according to the actual promotional conduct and only use scam if there is concrete fraud/malicious evidence.
- A fake-support message asking a user to enter their seed phrase on an external site => scam, remove, permanent enforcement penalty.
- A knowingly fabricated claim that the developers stole user funds, accompanied by invented evidence intended to cause panic => severe FUD, Rule 6, remove, normally penaltyPoints=10 unless history/context justifies more.
- A categorical accusation such as "the developers stole everyone's money" may be Rule 6 when the supplied context supports that it is a false accusation; do not infer falsity solely because the accusation is negative.

Use verdict=clean only with rule=none and disposition=allow.
Use verdict=low only for content that should remain visible.
Use verdict=severe for clear genuine removable rule violations, not merely contentious, sarcastic or negative speech.
Use verdict=scam only for concrete scam/fraud behaviour requiring immediate permanent enforcement.
Confidence and postOrganisation.confidence must be from 0 to 1. Evidence should be short fragments or descriptions, not long quotations.`;

const imageLike = (url: string): boolean => /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/iu.test(url)
  || /preview\.redd\.it|i\.redd\.it|external-preview\.redd\.it/iu.test(url);

const inputFor = (item: ModerationItem): readonly object[] => {
  const payload = JSON.stringify({
    source: 'reddit',
    kind: item.kind,
    subreddit: item.subreddit,
    author: item.author,
    title: item.title,
    text: item.text,
    permalink: item.permalink,
    mediaUrls: item.mediaUrls,
    history: item.history,
    postFlairs: item.postFlairs ?? [],
  });
  const content: object[] = [{ type: 'input_text', text: payload }];
  for (const url of item.mediaUrls.slice(0, 4)) {
    if (imageLike(url)) content.push({ type: 'input_image', image_url: url, detail: 'low' });
  }
  return [{ role: 'user', content }];
};

const checked = (value: ModerationClassification, item: ModerationItem): ModerationClassification => {
  if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    throw new Error('Moderation confidence must be from 0 to 1');
  }
  if (!Number.isSafeInteger(value.penaltyPoints) || value.penaltyPoints < 0) {
    throw new Error('Moderation penaltyPoints must be a non-negative safe integer');
  }
  if (value.verdict === 'clean' && (
    value.rule !== 'none'
    || value.disposition !== 'allow'
    || value.penaltyPoints !== 0
  )) {
    throw new Error('Clean moderation result must allow content, use no rule, and deduct zero points');
  }
  if (value.verdict === 'low' && (value.disposition !== 'allow' || value.penaltyPoints !== 1)) {
    throw new Error('Low moderation result must stay visible and deduct exactly one point');
  }
  if (value.verdict === 'severe' && (
    value.disposition !== 'remove'
    || value.penaltyPoints < 10
    || value.penaltyPoints > 999_999_999
  )) {
    throw new Error('Severe moderation result must remove content and deduct from 10 to 999,999,999 points');
  }
  if (value.verdict === 'scam' && (
    value.disposition !== 'remove'
    || value.penaltyPoints !== 999_999_999
  )) {
    throw new Error('Scam moderation result must remove content and use the permanent enforcement penalty');
  }

  const available = item.postFlairs ?? [];
  const organisation = value.postOrganisation ?? null;
  const shouldOrganise = item.kind === 'post' && value.disposition === 'allow' && available.length > 0;
  if (!shouldOrganise) {
    return {
      ...value,
      reason: value.reason.trim().slice(0, 700),
      evidence: value.evidence.map(entry => entry.trim()).filter(entry => entry.length > 0).slice(0, 6),
      postOrganisation: null,
    };
  }
  if (organisation === null) throw new Error('Allowed Reddit post classification requires postOrganisation');
  if (!available.some(flair => flair.id === organisation.flairTemplateId)) {
    throw new Error('Post organisation selected a flair outside the supplied inventory');
  }
  if (!Number.isFinite(organisation.confidence) || organisation.confidence < 0 || organisation.confidence > 1) {
    throw new Error('Post organisation confidence must be from 0 to 1');
  }

  let questionTitle = organisation.questionTitle.trim().replace(/\s+/gu, ' ').slice(0, 240);
  let questionSummary = organisation.questionSummary.trim().replace(/\s+/gu, ' ').slice(0, 900);
  if (organisation.isQuestion) {
    if (questionTitle.length === 0 || questionSummary.length === 0) {
      throw new Error('Question organisation requires a title and summary');
    }
    if (!questionTitle.endsWith('?')) questionTitle = `${questionTitle.replace(/[.!]+$/u, '')}?`;
  } else {
    questionTitle = '';
    questionSummary = '';
  }

  return {
    ...value,
    reason: value.reason.trim().slice(0, 700),
    evidence: value.evidence.map(entry => entry.trim()).filter(entry => entry.length > 0).slice(0, 6),
    postOrganisation: {
      ...organisation,
      questionTitle,
      questionSummary,
    },
  };
};

export class RedditModerationClassifier implements ConversationModerationClassifier {
  private readonly api: OpenAISchema<ModerationClassification>;

  public constructor(
    private readonly cfg: ModerationAiCfg,
    options: ModerationClassifierOptions = {},
  ) {
    this.api = openaiSchema<ModerationClassification>(
      cfg.key,
      classificationShape({
        kind: 'comment',
        subreddit: '',
        author: '',
        title: '',
        text: '',
        permalink: '',
        mediaUrls: [],
        history: null,
      }),
      options.conversationId,
      { conversation: options.conversation ?? false },
    );
  }

  public get conversationId(): string | undefined {
    return this.api.id;
  }

  public async classify(item: ModerationItem): Promise<ModerationClassification> {
    const value = await this.api.run(classificationShape(item), inputFor(item), {
      retries: 1,
      body: {
        model: this.cfg.model,
        instructions: moderationInstructions,
        reasoning: { effort: this.cfg.effort },
      },
    });
    return checked(value, item);
  }
}
