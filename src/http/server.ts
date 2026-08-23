import type { ModerationReviewStore } from '../mod/review.ts';
import type { ModmailStore } from '../modmail/store.ts';
import type { QuestionEventStore } from '../questions/events.ts';
import { isMap, parseJson } from '../types/json.ts';

export type RedditInternalHttpCfg = {
  readonly host: string;
  readonly port: number;
  readonly token: string;
};

export type RedditInternalHttpLogger = (line: string) => void;

const json = (value: object, status = 200): Response => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
});

const defaultLogger: RedditInternalHttpLogger = line => console.log(line);

const nonNegativeInt = (value: string | null, fallback: number): number | null => {
  if (value === null || value.length === 0) return fallback;
  if (!/^\d+$/u.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
};

export class RedditInternalHttpServer {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private modmail: ModmailStore | null = null;

  public constructor(
    private readonly cfg: RedditInternalHttpCfg,
    private readonly questions: QuestionEventStore,
    private readonly moderation: ModerationReviewStore,
    private readonly logger: RedditInternalHttpLogger = defaultLogger,
  ) {}

  public useModmail(store: ModmailStore): void {
    if (this.server !== null) throw new Error('Modmail store must be attached before the Reddit internal API starts');
    this.modmail = store;
  }

  public start(): void {
    if (this.server !== null) return;
    this.server = Bun.serve({
      hostname: this.cfg.host,
      port: this.cfg.port,
      fetch: req => this.route(req),
    });
  }

  public stop(): void {
    this.server?.stop();
    this.server = null;
  }

  public address(): string {
    const server = this.server;
    if (server === null) throw new Error('Reddit internal API is not running');
    const host = this.cfg.host === '::1' ? '[::1]' : this.cfg.host;
    return `http://${host}:${server.port}`;
  }

  private authorised(req: Request): boolean {
    return req.headers.get('authorization') === `Bearer ${this.cfg.token}`;
  }

  private record(req: Request, url: URL, response: Response, detail = ''): Response {
    const suffix = detail.length === 0 ? '' : ` ${detail}`;
    this.logger(`[Reddit internal API] ${new Date().toISOString()} ${req.method} ${url.pathname} -> ${response.status}${suffix}`);
    return response;
  }

  private async route(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/health') {
      return this.record(req, url, json({ ok: true }));
    }
    if (!this.authorised(req)) return this.record(req, url, json({ error: 'unauthorised' }, 401));

    if (req.method === 'GET' && url.pathname === '/v1/question-events') {
      const after = nonNegativeInt(url.searchParams.get('after'), 0);
      const limit = nonNegativeInt(url.searchParams.get('limit'), 100);
      if (after === null || limit === null || limit < 1 || limit > 100) {
        return this.record(req, url, json({ error: 'invalid cursor or limit' }, 400));
      }
      const page = await this.questions.after(after, limit);
      return this.record(req, url, json(page), `after=${after} events=${page.events.length} next=${page.next}`);
    }

    if (req.method === 'GET' && url.pathname === '/v1/modmail/events') {
      if (this.modmail === null) return this.record(req, url, json({ error: 'modmail unavailable' }, 503));
      const after = nonNegativeInt(url.searchParams.get('after'), 0);
      const limit = nonNegativeInt(url.searchParams.get('limit'), 100);
      if (after === null || limit === null || limit < 1 || limit > 100) {
        return this.record(req, url, json({ error: 'invalid cursor or limit' }, 400));
      }
      const page = await this.modmail.eventsAfter(after, limit);
      return this.record(req, url, json(page), `after=${after} events=${page.events.length} next=${page.next}`);
    }

    if (req.method === 'GET' && url.pathname.startsWith('/v1/modmail/conversations/')) {
      if (this.modmail === null) return this.record(req, url, json({ error: 'modmail unavailable' }, 503));
      const id = decodeURIComponent(url.pathname.slice('/v1/modmail/conversations/'.length)).trim();
      if (!/^[A-Za-z0-9]+$/u.test(id)) return this.record(req, url, json({ error: 'invalid conversation id' }, 400));
      const conversation = await this.modmail.conversation(id);
      if (conversation === null) return this.record(req, url, json({ error: 'conversation not found' }, 404));
      return this.record(req, url, json({ conversation }), `conversation=${id} messages=${conversation.messages.length}`);
    }

    if (req.method === 'GET' && url.pathname === '/v1/moderation/reviews/pending') {
      const reviews = await this.moderation.pending();
      return this.record(req, url, json({ reviews }), `reviews=${reviews.length}`);
    }

    if (req.method === 'POST' && url.pathname === '/v1/moderation/reviews/decision') {
      const body = parseJson(await req.text());
      if (!isMap(body)) return this.record(req, url, json({ error: 'invalid decision body' }, 400));
      const key = body['key'];
      const choice = body['choice'];
      const platform = body['platform'];
      const userId = body['userId'];
      const userName = body['userName'];
      const at = body['at'];
      if (
        typeof key !== 'string' || key.length === 0
        || (choice !== 'approve' && choice !== 'reject')
        || (platform !== 'telegram' && platform !== 'discord')
        || typeof userId !== 'string' || userId.length === 0
        || typeof userName !== 'string'
        || typeof at !== 'number' || !Number.isSafeInteger(at) || at < 0
      ) return this.record(req, url, json({ error: 'invalid decision body' }, 400));
      const claim = await this.moderation.decide(key, { choice, platform, userId, userName, at });
      if (claim === null) return this.record(req, url, json({ error: 'review not found' }, 404), `review=${key}`);
      return this.record(req, url, json(claim), `review=${key} choice=${claim.review.decision?.choice ?? 'none'} won=${claim.won}`);
    }

    return this.record(req, url, json({ error: 'not found' }, 404));
  }
}
