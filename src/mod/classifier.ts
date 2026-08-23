import {
  array,
  number,
  object,
  openaiSchema,
  shape,
  string,
  type OpenAISchema,
} from '../../vendor/openai-schema/src/openaiSchema.ts';

export type ModerationVerdict = 'clean' | 'low' | 'severe' | 'scam';
export type ModerationRule = 'none' | 'rule_2' | 'rule_3' | 'rule_5' | 'rule_6' | 'reddit_site' | 'other';
export type ModerationDisposition = 'allow' | 'remove';

export type ModerationClassification = {
  readonly verdict: ModerationVerdict;
  readonly rule: ModerationRule;
  readonly disposition: ModerationDisposition;
  readonly confidence: number;
  readonly reason: string;
  readonly evidence: readonly string[];
};

export type ModerationItem = {
  readonly kind: 'post' | 'comment';
  readonly subreddit: string;
  readonly author: string;
  readonly title: string;
  readonly text: string;
  readonly permalink: string;
  readonly mediaUrls: readonly string[];
};

export type ModerationAiCfg = {
  readonly key: string;
  readonly model: string;
  readonly effort: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
};

const classificationShape = shape<ModerationClassification>('MaeRedditModeration', object({
  verdict: string(['clean', 'low', 'severe', 'scam']),
  rule: string(['none', 'rule_2', 'rule_3', 'rule_5', 'rule_6', 'reddit_site', 'other']),
  disposition: string(['allow', 'remove']),
  confidence: number(),
  reason: string(),
  evidence: array(string(), 0, 6),
}));

export const moderationInstructions = `You are Mae's deterministic semantic moderation classifier for the Catgirl Coin community.
Audit the supplied Reddit post or comment against the actual community rules and return only the requested structured output.

The important policy distinctions are:
- Fair criticism, scepticism, disappointment, questions, disagreement and negative opinions are allowed. Do not punish criticism merely because it is negative about the project, token, price or community.
- Personal, needlessly hostile or non-constructive criticism can be a LOW violation under Rule 2. LOW content stays visible: disposition=allow.
- FUD means unsupported or manipulative fear/uncertainty/doubt presented as fact, accusatory financial-loss claims used to inflame the community, bullying-grade doomposting, or visual/textual material whose substantive message is that the project is dead/a scam/a dead end without constructive support. FUD is SEVERE under Rule 6 and is removed.
- Harassment, direct bullying or personal hostility is Rule 2 unless it actually rises to harassment/hate/bigotry, which is Rule 3. Serious cases are SEVERE and removed.
- Promotion of other cryptocurrencies is Rule 5. Scams, malicious promotion, phishing, wallet-draining schemes or promotional abuse are verdict=SCAM and removed.
- Apply Reddit sitewide harassment/hate/threat rules when genuinely applicable, but do not stretch those labels to ordinary criticism.

Calibration examples:
- "Had no idea this was still alive tbh." => clean.
- "Catgirl is still a thing?" => clean.
- A detailed support/wallet complaint ending with a gratuitous personal "screw this crypto" style attack => low, usually Rule 2, allow.
- "Give me back my $15000" as an accusatory drive-by financial-loss claim => severe FUD, Rule 6, remove.
- "This still going lol lost most of my money" as doomposting/FUD => severe, Rule 6, remove.
- A GIF or image whose substantive message is "DEAD END" plus dismissive roadmap commentary => severe visual FUD, Rule 6, remove.

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
  if (value.verdict === 'clean' && (value.rule !== 'none' || value.disposition !== 'allow')) {
    throw new Error('Clean moderation result must allow content with no rule violation');
  }
  if (value.verdict === 'low' && value.disposition !== 'allow') {
    throw new Error('Low moderation result must leave content visible');
  }
  if ((value.verdict === 'severe' || value.verdict === 'scam') && value.disposition !== 'remove') {
    throw new Error('Severe moderation result must remove content');
  }
  return {
    ...value,
    reason: value.reason.trim().slice(0, 700),
    evidence: value.evidence.map(entry => entry.trim()).filter(entry => entry.length > 0).slice(0, 6),
  };
};

export class RedditModerationClassifier {
  private readonly api: OpenAISchema<ModerationClassification>;

  public constructor(private readonly cfg: ModerationAiCfg) {
    this.api = openaiSchema<ModerationClassification>(cfg.key, classificationShape, undefined, { conversation: false });
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
