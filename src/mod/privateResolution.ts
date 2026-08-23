import {
  boolean,
  object,
  openaiSchema,
  shape,
  string,
  type OpenAISchema,
} from '../../vendor/openai-schema/src/openaiSchema.ts';
import type { ModerationAiCfg } from './classifier.ts';

export type PrivateResolution = {
  readonly genuineApology: boolean;
  readonly reason: string;
};

export type PrivateResolutionClassifier = {
  classify(text: string): Promise<PrivateResolution>;
};

const resolutionShape = shape<PrivateResolution>('MaeRedditPrivateResolution', object({
  genuineApology: boolean(),
  reason: string(),
}));

export const privateResolutionInstructions = `You classify whether a private message to Mae is a genuine apology for the purpose of reopening access to human moderators.
Return only the requested structured output.

A genuine apology does not require the literal word "sorry". It can acknowledge wrongdoing, accept responsibility, express remorse, or sincerely apologise in other words. Examples include "I was wrong, apologies" and "I shouldn't have spoken to you like that".

The presence of apology-related words is never sufficient by itself. A message such as "why would I need to say sorry, bitch?" is not an apology. Sarcasm, mock apologies, conditional non-apologies, insults wrapped around the word sorry, threats, demands, and attempts to game the rule are not genuine apologies.

Be conservative but not pedantic. The user does not need to grovel, flatter Mae, admit to facts they dispute, or use a specific formula. A short sincere conciliatory acknowledgement is enough.

The reason must be concise and explain the semantic distinction without moralising.`;

export class RedditPrivateResolutionClassifier implements PrivateResolutionClassifier {
  private readonly api: OpenAISchema<PrivateResolution>;

  public constructor(private readonly cfg: ModerationAiCfg) {
    this.api = openaiSchema<PrivateResolution>(cfg.key, resolutionShape, undefined, { conversation: false });
  }

  public async classify(text: string): Promise<PrivateResolution> {
    const value = await this.api.send([{
      role: 'user',
      content: [{ type: 'input_text', text: JSON.stringify({ source: 'reddit-private-message', text }) }],
    }], {
      retries: 1,
      body: {
        model: this.cfg.model,
        instructions: privateResolutionInstructions,
        reasoning: { effort: this.cfg.effort },
      },
    });
    return {
      genuineApology: value.genuineApology,
      reason: value.reason.trim().slice(0, 500),
    };
  }
}
