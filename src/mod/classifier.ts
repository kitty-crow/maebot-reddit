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

Moderation must be conservative about severe enforcement. A negative tone, profanity about the token/project, sarcasm, an exchange name, another cryptocurrency name, a financial-loss statement, criticism of the project, or lack of supporting evidence is not by itself a severe violation. When content plausibly fits clean or low and the evidence for a removable violation is ambiguous, choose the less severe classification. Never infer malicious or promotional intent merely from a crypto-related name or from negativity.

The important policy distinctions are:
- Fair criticism, scepticism, disappointment, questions, disagreement and negative opinions are allowed. Users are allowed to be unhappy with the project, token, price, developers, roadmap or their investment outcome.
- Sarcasm is allowed. Sarcasm does not become a violation merely because it mocks the price, project performance or the user's own investment loss.
- Profanity or contempt directed at the PROJECT/TOKEN rather than another person is allowed by itself. Calling the token "shit", "garbage", "terrible", a "shitcoin", a bad investment, badly managed, dead, or similar negative opinion is not a moderation violation merely because it is rude toward the project.
- First-person reports of investment performance or loss are allowed, including angry, disappointed, profane or sarcastic phrasing. Statements such as "I lost most of my money", "I went from $1000 to $4", "the price crashed hard", "great investment lol", or "what a shit coin, lost my $700 and now I only have $4" are not FUD. Crypto users can genuinely lose money and are allowed to be unhappy about it.
- Personal, needlessly hostile or non-constructive attacks directed at ANOTHER PERSON can be a LOW violation under Rule 2. LOW content stays visible: disposition=allow and penaltyPoints=1. Evaluate a personal insult separately from any otherwise allowed criticism or loss report in the same comment.
- Rule 6 severe FUD covers categorical accusations that the project/team is committing fraud or has rugged/stolen funds, and materially false/fabricated accusations of wrongdoing. Clear examples include "this project is an obvious scam", "this is a rugpull", "the developers bagged the funds and ran away", "the team stole everyone's money", or fabricated evidence intended to prove fraud/theft/rugging.
- A categorical statement that the project IS a scam/rugpull is Rule 6 severe even though the speaker may frame it as their opinion. A genuine question or uncertainty such as "is this a scam?", "I'm worried this could be a scam", or "this feels scammy to me" is not the same categorical accusation and should not automatically be severe.
- Calling the project unsuccessful, dead, badly managed, disappointing, overpriced, a terrible investment, a shitcoin, or expressing pessimism is not Rule 6. Negative opinion and dissatisfaction are allowed.
- Do not reinterpret an ordinary investment-loss report as an accusation. "I bought at the top and lost everything" means exactly that unless the user separately alleges fraud/rugging/theft.
- For accusations of wrongdoing other than the explicit scam/rugpull/funds-stolen categories above, do not manufacture certainty. Severe Rule 6 requires the supplied content/context to support that it is a materially false, fabricated or manipulative accusation.
- A user ACCUSING the project of being a scam is verdict=severe with rule=rule_6, normally penaltyPoints=10. It is NOT verdict=scam. verdict=scam is reserved for a commenter who is themselves perpetrating or facilitating an actual scam.
- Harassment, direct bullying or personal hostility is Rule 2 unless it actually rises to harassment/hate/bigotry, which is Rule 3. Serious cases are SEVERE and removed.
- Rule 5 is about PROMOTIONAL INTENT toward an unrelated cryptocurrency/project, not the mere presence of another crypto name. Mentioning, comparing, criticising, praising, owning, selling, discovering Catgirl through, or otherwise discussing another coin/project is allowed when the purpose is context, comparison, personal history or ordinary conversation.
- References to infrastructure are normal crypto discussion. Networks, base/native assets, exchanges, bridges, wallets, liquidity venues, gas, transfer routes and trading venues may be mentioned, compared or recommended when relevant. Their names are not evidence of Rule 5 promotion or scam by themselves.
- The Nya/Catgirl first-party ecosystem explicitly includes Catgirl Coin, uniPAWS, FunHunt and Kemi. Mentioning, recommending, linking, explaining or helping with these first-party ecosystem products is not Rule 5 promotion by itself.
- Rule 5 requires an actual attempt to promote or divert users toward an UNRELATED project, such as a promotional call-to-action, "buy this token", "join this presale", repeated shilling, referral solicitation, vested/self-interested promotion, or directing users away from the community toward another crypto/project for promotional purposes.
- Contextual comparisons are allowed even when favourable to another coin. "This is the next Shiba Inu", "good thing this is not like Luna/Terra", or explaining that the user discovered Catgirl because they previously owned another coin are not Rule 5 without actual promotional intent.
- Mentioning, explaining, comparing, recommending the use of, or troubleshooting a legitimate cryptocurrency exchange is allowed. Exchange names, exchange links, listings, fees, transfer instructions and answers about where/how to buy Catgirl are not self-promotion and are not evidence of a scam by themselves.
- verdict=SCAM requires concrete scam indicators showing that the commenter is perpetrating/facilitating a scam, such as phishing, wallet-draining instructions or links, seed/private-key requests, fake support/impersonation, fraudulent presales, malicious token promotion, or similarly deceptive theft/fraud behaviour. Never infer scam merely because a comment mentions an exchange, network, service, token, link, or buying/selling crypto.
- Apply Reddit sitewide harassment/hate/threat rules when genuinely applicable, but do not stretch those labels to ordinary criticism.

Reputation penalty rules:
- clean: penaltyPoints=0.
- low: penaltyPoints=1.
- severe: penaltyPoints must be at least 10. Ten is the normal severe penalty. You may choose a larger integer when the event itself is exceptionally serious or the supplied history shows repeated/recent serious violations. The amount must be proportionate and explained in reason. Do not increase a penalty merely because the user's current score is low.
- scam: penaltyPoints=999999999. Deterministic code treats scam as immediate permanent enforcement, so use this verdict only when the supplied content itself contains strong concrete evidence that the commenter is perpetrating/facilitating scam behaviour.

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
- "What a shit coin, lost my $700 and now I only have $4" => clean, penaltyPoints=0; profanity about the token plus a personal loss report is allowed.
- "Worst investment I've ever made. This coin is garbage." => clean, penaltyPoints=0.
- "The devs have handled this terribly" => clean, penaltyPoints=0 as criticism/opinion.
- "The price is dead and I regret ever buying" => clean, penaltyPoints=0.
- A support/wallet complaint ending with a gratuitous personal insult directed at another user => low, Rule 2, allow, penaltyPoints=1.
- "You basement dwelling dweeb" directed at another user => low, Rule 2, allow, penaltyPoints=1 unless surrounding conduct genuinely establishes serious harassment.
- "You are an idiot for buying this shitcoin" => low, Rule 2, allow, penaltyPoints=1 because of the direct personal insult; the word "shitcoin" itself is not the violation.
- "This project is an obvious scam" => severe, Rule 6, remove, normally penaltyPoints=10. This is NOT verdict=scam.
- "This is a rugpull" => severe, Rule 6, remove, normally penaltyPoints=10. This is NOT verdict=scam.
- "The developers bagged the funds and ran away" => severe, Rule 6, remove, normally penaltyPoints=10. This is NOT verdict=scam.
- "The team stole everyone's money" => severe, Rule 6, remove, normally penaltyPoints=10. This is NOT verdict=scam.
- "Is this a scam? I'm worried because the price collapsed" => clean unless some separate violation exists; questioning/concern is not the same as a categorical accusation.
- "This is the next Shiba Inu!" => clean; a comparison is not promotion of Shiba Inu.
- "Good thing this is not like Luna/Terra, love that the devs keep working" => clean; contextual comparison, not promotion.
- "I learned about this because I had some FoxGirl and saw the dev had a bunch of this coin" => clean; personal discovery context, not promotion of FoxGirl.
- "I own BTC, ETH and Catgirl" => clean; ordinary personal context.
- "BNB gas is cheaper for me" or "bridge it through Base/Arbitrum/Polygon" => clean when offered as relevant technical/infrastructure discussion.
- "You can buy Catgirl on Binance" or instructions for transferring Catgirl from an exchange to a wallet => clean, penaltyPoints=0.
- "Try uniPAWS for that", "FunHunt is part of the ecosystem", or "Kemi handles that feature" => clean; first-party Nya/Catgirl ecosystem discussion.
- "Forget Catgirl, buy my osamaSonicShitCoin, join the presale here" => Rule 5 promotion; only use verdict=scam if there is concrete evidence the commenter is perpetrating/facilitating fraud.
- "Everyone dump Catgirl and buy FooCoin, it is going 100x" => Rule 5 promotion.
- A fake-support message asking a user to enter their seed phrase on an external site => scam, remove, permanent enforcement penalty.
- Fabricated screenshots/evidence presented to falsely prove that the team stole funds or rugged the project => severe FUD, Rule 6, remove, with a proportionate severe penalty.

Use verdict=clean only with rule=none and disposition=allow.
Use verdict=low only for content that should remain visible.
Use verdict=severe for clear genuine removable rule violations, not merely contentious, profane, sarcastic or negative speech.
Use verdict=scam only when the commenter is actually perpetrating/facilitating concrete scam/fraud behaviour requiring immediate permanent enforcement.
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