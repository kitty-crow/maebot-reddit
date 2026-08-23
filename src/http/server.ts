import type { ModerationReviewStore } from '../mod/review.ts';
import type { ModmailReplyOutbox } from '../modmail/outbox.ts';
import type { ModmailStore } from '../modmail/store.ts';
import type { ModmailTerminalServer } from '../modmail/terminalServer.ts';
import type { QuestionEventStore } from '../questions/events.ts';
import type { ReputationStore } from '../reputation/store.ts';
import { isMap, parseJson } from '../types/json.ts';

export type RedditInternalHttpCfg = {
  readonly host: string;
  readonly port: number;
  readonly token: string;
};

export type RedditInternalHttpLogger = (line: string) => void;

type ModmailReputationReader = Pick<ReputationStore, 'user'>;

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

const bodyMap = async (req: Request): Promise<ReturnType<typeof parseJson> | null> => {
  try {
    return parseJson(await req.text());
  } catch {
    return null;
  }
};

const platform = (value: unknown): 'telegram' | 'discord' | null =>
  value === 'telegram' || value === 'discord' ? value : null;

const simpleKey = (value: unknown): string | null =>
  typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/u.test(value) ? value : null;

const conversationId = (value: unknown): string | null =>
  typeof value === 'string' && /^[A-Za-z0-9]+$/u.test(value) ? value : null;

const nonEmptyText = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 && text.length <= max ? text : null;
};

export class RedditInternalHttpServer {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private modmail: ModmailStore | null = null;
  private modmailReplies: ModmailReplyOutbox | null = null;
  private modmailTerminal: ModmailTerminalServer | null = null;
  private modmailReputation: ModmailReputationReader | null = null;

  public constructor(
    private readonly cfg: RedditInternalHttpCfg,
    private readonly questions: QuestionEventStore,
    private readonly moderation: ModerationReviewStore,
    private readonly logger: RedditInternalHttpLogger = defaultLogger,
  ) {}

  public useModmail(
    store: ModmailStore,
    replies: ModmailReplyOutbox,
    terminal: ModmailTerminalServer | null,
    reputation: ModmailReputationReader | null = null,
  ): void {
    if (this.server !== null) throw new Error('Modmail services must be attached before the Reddit internal API starts');
    this.modmail = store;
    this.modmailReplies = replies;
    this.modmailTerminal = terminal;
    this.modmailReputation = reputation;
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

  private async reply(req: Request, url: URL): Promise<Response> {
    if (this.modmail === null || this.modmailReplies === null) {
      return this.record(req, url, json({ error: 'modmail unavailable' }, 503));
    }
    const raw = await bodyMap(req);
    if (!isMap(raw)) return this.record(req, url, json({ error: 'invalid reply body' }, 400));
    const key = simpleKey(raw['key']);
    const id = conversationId(raw['conversationId']);
    const source = platform(raw['platform']);
    const userId = nonEmptyText(raw['userId'], 128);
    const handle = nonEmptyText(raw['handle'], 128);
    const text = nonEmptyText(raw['text'], 10_000);
    if (key === null || id === null || source === null || userId === null || handle === null || text === null) {
      return this.record(req, url, json({ error: 'invalid reply body' }, 400));
    }
    const conversation = await this.modmail.conversation(id);
    if (conversation === null) return this.record(req, url, json({ error: 'conversation not found' }, 404));
    if (conversation.state === 'archived') return this.record(req, url, json({ error: 'conversation archived' }, 409));
    const queued = await this.modmailReplies.queue({
      key,
      conversationId: id,
      moderator: { platform: source, userId, handle },
      text,
    });
    return this.record(req, url, json({ queued: true, reply: queued }, 202), `conversation=${id} key=${key}`);
  }

  private async terminal(req: Request, url: URL): Promise<Response> {
    if (this.modmailTerminal === null) {
      return this.record(req, url, json({ error: 'focused modmail terminal unavailable' }, 503));
    }
    const raw = await bodyMap(req);
    if (!isMap(raw)) return this.record(req, url, json({ error: 'invalid terminal request' }, 400));
    const id = conversationId(raw['conversationId']);
    const source = platform(raw['platform']);
    const userId = nonEmptyText(raw['userId'], 128);
    const handle = nonEmptyText(raw['handle'], 128);
    if (id === null || source === null || userId === null || handle === null) {
      return this.record(req, url, json({ error: 'invalid terminal request' }, 400));
    }
    try {
      const link = await this.modmailTerminal.issue(id, { platform: source, userId, handle });
      return this.record(req, url, json(link, 201), `conversation=${id} platform=${source}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'terminal unavailable';
      const status = message.includes('Unknown modmail conversation') ? 404 : message.includes('archived') ? 409 : 400;
      return this.record(req, url, json({ error: message }, status), `conversation=${id}`);
    }
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
      const participant = conversation.participant?.name ?? null;
      const reputation = participant === null || this.modmailReputation === null
        ? null
        : await this.modmailReputation.user(participant);
      return this.record(
        req,
        url,
        json({ conversation, reputation }),
        `conversation=${id} messages=${conversation.messages.length} reputation=${reputation?.points ?? 'none'}`,
      );
    }

    if (req.method === 'POST' && url.pathname === '/v1/modmail/replies') return await this.reply(req, url);
    if (req.method === 'POST' && url.pathname === '/v1/modmail/terminal-sessions') return await this.terminal(req, url);

    if (req.method === 'GET' && url.pathname === '/v1/moderation/reviews/pending') {
      const reviews = await this.moderation.pending();
      return this.record(req, url, json({ reviews }), `reviews=${reviews.length}`);
    }

    if (req.method === 'GET' && url.pathname.startsWith('/v1/moderation/reviews/')) {
      const rawKey = decodeURIComponent(url.pathname.slice('/v1/moderation/reviews/'.length)).trim();
      const key = simpleKey(rawKey);
      if (key === null) return this.record(req, url, json({ error: 'invalid review key' }, 400));
      const review = await this.moderation.get(key);
      if (review === null) return this.record(req, url, json({ error: 'review not found' }, 404), `review=${key}`);
      return this.record(req, url, json({ review }), `review=${key} decision=${review.decision?.choice ?? 'pending'}`);
    }

    if (req.method === 'POST' && url.pathname === '/v1/moderation/reviews/decision') {
      const body = await bodyMap(req);
      if (!isMap(body)) return this.record(req, url, json({ error: 'invalid decision body' }, 400));
      const key = body['key'];
      const choice = body['choice'];
      const source = body['platform'];
      const userId = body['userId'];
      const userName = body['userName'];
      const at = body['at'];
      if (
        typeof key !== 'string' || key.length === 0
        || (choice !== 'approve' && choice !== 'reject')
        || (source !== 'telegram' && source !== 'discord')
        || typeof userId !== 'string' || userId.length === 0
        || typeof userName !== 'string'
        || typeof at !== 'number' || !Number.isSafeInteger(at) || at < 0
      ) return this.record(req, url, json({ error: 'invalid decision body' }, 400));
      const claim = await this.moderation.decide(key, { choice, platform: source, userId, userName, at });
      if (claim === null) return this.record(req, url, json({ error: 'review not found' }, 404), `review=${key}`);
      return this.record(req, url, json(claim), `review=${key} choice=${claim.review.decision?.choice ?? 'none'} won=${claim.won}`);
    }

    return this.record(req, url, json({ error: 'not found' }, 404));
  }
}
