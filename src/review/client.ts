import { arrVal, boolVal, mapVal, numVal, strVal } from '../types/value.ts';
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

export type CanonicalWeeklyMedia = {
  readonly kind: 'image' | 'video';
  readonly mime: string;
  readonly size: number;
};

export type CanonicalWeeklyReview = {
  readonly key: string;
  readonly weekStart: string;
  readonly markdown: string;
  readonly decision: {
    readonly choice: 'approve';
    readonly at: number;
  };
  readonly applied: true;
  readonly media: CanonicalWeeklyMedia | null;
};

export type DailyReviewApi = {
  twitter(account: string, tweetId: string): Promise<CanonicalDailyReview | null>;
  weekly(after?: number): Promise<readonly CanonicalWeeklyReview[]>;
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
    const applied = boolVal(review['applied'], 'Daily Review API response.review.applied');
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

  public async weekly(after = 0): Promise<readonly CanonicalWeeklyReview[]> {
    if (!Number.isSafeInteger(after) || after < 0) throw new Error('Weekly Daily Review cursor must be a non-negative integer');
    const path = `/v1/weekly?after=${after}`;
    let response: Response;
    try {
      response = await this.fetcher(`${this.base}${path}`, {
        headers: { authorization: `Bearer ${this.token}` },
      });
    } catch {
      throw new Error('Daily Review API request failed at the network boundary');
    }
    if (!response.ok) throw new Error(`Daily Review API /v1/weekly failed with HTTP ${response.status}`);

    const root = mapVal(parseJson(await response.text()), 'Daily Review API weekly response');
    return arrVal(root['reviews'], 'Daily Review API weekly response.reviews').map((raw, index) => {
      const review = mapVal(raw, `Daily Review API weekly response.reviews[${index}]`);
      const key = strVal(review['key'], `Daily Review API weekly response.reviews[${index}].key`);
      const weekStart = strVal(review['weekStart'], `Daily Review API weekly response.reviews[${index}].weekStart`);
      const markdown = strVal(review['markdown'], `Daily Review API weekly response.reviews[${index}].markdown`);
      if (!/^weekly:\d{4}-\d{2}-\d{2}$/u.test(key) || !/^\d{4}-\d{2}-\d{2}$/u.test(weekStart)) {
        throw new Error('Daily Review API returned an invalid weekly identity');
      }
      const decisionRaw = mapVal(review['decision'], `Daily Review API weekly response.reviews[${index}].decision`);
      const choice = strVal(decisionRaw['choice'], `Daily Review API weekly response.reviews[${index}].decision.choice`);
      if (choice !== 'approve') throw new Error('Daily Review API returned a non-approved weekly review');
      const decision = {
        choice: 'approve' as const,
        at: numVal(decisionRaw['at'], `Daily Review API weekly response.reviews[${index}].decision.at`),
      };
      if (!boolVal(review['applied'], `Daily Review API weekly response.reviews[${index}].applied`)) {
        throw new Error('Daily Review API returned an unapplied weekly review');
      }
      const rawMedia = review['media'];
      let media: CanonicalWeeklyMedia | null = null;
      if (rawMedia !== null && rawMedia !== undefined) {
        const value = mapVal(rawMedia, `Daily Review API weekly response.reviews[${index}].media`);
        const kind = strVal(value['kind'], `Daily Review API weekly response.reviews[${index}].media.kind`);
        if (kind !== 'image' && kind !== 'video') throw new Error('Daily Review API returned an invalid weekly media kind');
        media = {
          kind,
          mime: strVal(value['mime'], `Daily Review API weekly response.reviews[${index}].media.mime`),
          size: numVal(value['size'], `Daily Review API weekly response.reviews[${index}].media.size`),
        };
      }
      return { key, weekStart, markdown, decision, applied: true as const, media };
    });
  }
}
