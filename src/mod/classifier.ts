import {
  array,
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

export type ModerationClassification = {
  readonly verdict: ModerationVerdict;
  readonly rule: ModerationRule;
  readonly disposition: ModerationDisposition;
  readonly penaltyPoints: number;
  readonly confidence: number;
  readonly reason: string;
  readonly evidence: readonly string[];
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

const classificationShape = shape<ModerationClassification>('MaeRedditModeration', object({
  verdict: string(['clean', 'low', 'severe', 'scam']),
  rule: string(['none', 'rule_2', 'rule_3', 'rule_5', 'rule_6', 'reddit_site', 'other']),
  disposition: string(['allow', 'remove']),
  penaltyPoints: number(),
  confidence: number(),
  reason: string(),
  evidence: array(string(), 0, 6),
}));

export const moderationInstructions = `You are Mae's deterministic semantic moderation classifier for the Catgirl Coin community.
Audit the supplied Reddit content against the actual community rules and return only the requested structured output.

The supplied history is authoritative context about this user's Mae reputation and recent rule violations. Use it only to calibrate the penalty of a genuine severe violation. Never turn ordinary criticism into a violation because the user has a bad history.

The important policy distinctions are:
- Fair criticism, scepticism, disappointment, questions, disagreement and negative opinions are allowed. Do not punish criticism merely because it is negative about the project, token, price or community.
- Personal, needlessly hostile or non-constructive criticism can be a LOW violation under Rule 2. LOW content stays visible: disposition=allow and penaltyPoints=1.
- FUD means unsupported or manipulative fear/uncertainty/doubt presented as fact, accusatory financial-loss claims used to inflame the community, bullying-grade doomposting, or visual/textual material whose substantive message is that the project is dead/a scam/a dead end without constructive support. FUD is SEVERE under Rule 6 and is removed.
- Harassment, direct bullying or personal hostility is Rule 2 unless it actually rises to harassment/hate/bigotry, which is Rule 3. Serious cases are SEVERE and removed.
- Promotion of other cryptocurrencies is Rule 5. Scams, malicious promotion, phishing, wallet-draining schemes or promotional abuse are verdict=SCAM and removed immediately.
- Apply Reddit sitewide harassment/hate/threat rules when genuinely applicable, but do not stretch those labels to ordinary criticism.

Reputation penalty rules:
- clean: penaltyPoints=0.
- low: penaltyPoints=1.
- severe: penaltyPoints must be at least 10. Ten is the normal severe penalty. You may choose a larger integer when the event itself is exceptionally serious or the supplied history shows repeated/recent serious violations. The amount must be proportionate and explained in reason. Do not increase a penalty merely because the user's current score is low.
- scam: penaltyPoints=999999999. Deterministic code treats scam as immediate permanent enforcement.

Calibration examples:
- "Had no idea this was still alive tbh." => clean, penaltyPoints=0.
- "Catgirl is still a thing?" => clean, penaltyPoints=0.
- A detailed support/wallet complaint ending with a gratuitous personal "screw this crypto" style attack => low, usually Rule 2, allow, penaltyPoints=1.
- "Give me back my $15000" as an accusatory drive-by financial-loss claim => severe FUD, Rule 6, remove, normally penaltyPoints=10 unless history/context justifies more.
- "This still going lol lost most of my money" as doomposting/FUD => severe, Rule 6, remove, normally penaltyPoints=10 unless history/context justifies more.
- A GIF or image whose substantive message is "DEAD END" plus dismissive roadmap commentary => severe visual FUD, Rule 6, remove, normally penaltyPoints=10 unless history/context justifies more.

Use verdict=clean only with rule=none and disposition=allow.
Use verdict=low only for content that should remain visible.
Use verdict=severe for genuine removable rule violations.
Use verdict=scam for scams/promotion requiring immediate permanent enforcement.
Confidence must be from 0 to 1. Evidence should be short fragments or descriptions, not long quotations.`;

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
  });
  const content: object[] = [{ type: 'input_text', text: payload }];
  for (const url of item.mediaUrls.slice(0, 4)) {
    if (imageLike(url)) content.push({ type: 'input_image', image_url: url, detail: 'low' });
  }
  return [{ role: 'user', content }];
};

const checked = (value: ModerationClassification): ModerationClassification => {
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
  return {
    ...value,
    reason: value.reason.trim().slice(0, 700),
    evidence: value.evidence.map(entry => entry.trim()).filter(entry => entry.length > 0).slice(0, 6),
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
      classificationShape,
      options.conversationId,
      { conversation: options.conversation ?? false },
    );
  }

  public get conversationId(): string | undefined {
    return this.api.id;
  }

  public async classify(item: ModerationItem): Promise<ModerationClassification> {
    const value = await this.api.send(inputFor(item), {
      retries: 1,
      body: {
        model: this.cfg.model,
        instructions: moderationInstructions,
        reasoning: { effort: this.cfg.effort },
      },
    });
    return checked(value);
  }
}
