import { mapVal, numVal, strVal } from '../types/value.ts';
import { parseJson } from '../types/json.ts';

export type DailyReviewClientCfg = {
  readonly base: string;
  readonly token: string;
};

export type CanonicalDailyReview = {
  readonly key: string;
  readonly account: string;
  readonly tweetId: string;
  readonly decision: null | {
    readonly choice: 'approve' | 'reject';
    readonly at: number;
  };
  readonly applied: boolean;
};

export type DailyReviewApi = {
  twitter(account: string, tweetId: string): Promise<CanonicalDailyReview | null>;
};

export type DailyReviewFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const loopback = (value: string): string => {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'http:' || (host !== '127.0.0.1' && host !== '::1' && host !== '[::1]' && host !== 'localhost')) {
    throw new Error('Daily Review API base must be a loopback HTTP URL');
  }
  return url.toString().replace(/\/$/u, '');
};

export class DailyReviewClient implements DailyReviewApi {
  private readonly base: string;
  private readonly token: string;

  public constructor(cfg: DailyReviewClientCfg, private readonly fetcher: DailyReviewFetch = fetch) {
    this.base = loopback(cfg.base);
    this.token = cfg.token.trim();
    if (this.token.length === 0) throw new Error('Daily Review API token is required');
  }

  public async twitter(account: string, tweetId: string): Promise<CanonicalDailyReview | null> {
    const path = `/v1/twitter/${encodeURIComponent(account)}/${encodeURIComponent(tweetId)}`;
    let response: Response;
    try {
      response = await this.fetcher(`${this.base}${path}`, {
        headers: { authorization: `Bearer ${this.token}` },
      });
    } catch {
      throw new Error('Daily Review API request failed at the network boundary');
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Daily Review API ${path} failed with HTTP ${response.status}`);

    const root = mapVal(parseJson(await response.text()), 'Daily Review API response');
    const review = mapVal(root['review'], 'Daily Review API response.review');
    const rawDecision = review['decision'];
    let decision: CanonicalDailyReview['decision'] = null;
    if (rawDecision !== null && rawDecision !== undefined) {
      const value = mapVal(rawDecision, 'Daily Review API response.review.decision');
      const choice = strVal(value['choice'], 'Daily Review API response.review.decision.choice');
      if (choice !== 'approve' && choice !== 'reject') throw new Error('Daily Review API returned an invalid decision');
      decision = { choice, at: numVal(value['at'], 'Daily Review API response.review.decision.at') };
    }
    const applied = review['applied'];
    if (typeof applied !== 'boolean') throw new Error('Daily Review API returned an invalid applied state');
    const key = strVal(review['key'], 'Daily Review API response.review.key');
    const responseAccount = strVal(review['account'], 'Daily Review API response.review.account');
    const responseTweetId = strVal(review['tweetId'], 'Daily Review API response.review.tweetId');
    if (responseAccount.toLowerCase() !== account.toLowerCase() || responseTweetId !== tweetId) {
      throw new Error('Daily Review API returned a mismatched Twitter identity');
    }
    return {
      key,
      account: responseAccount,
      tweetId: responseTweetId,
      decision,
      applied,
    };
  }
}
