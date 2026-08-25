import type { ModerationReviewStore } from '../mod/review.ts';
import type { ModmailMediaService } from '../modmail/media/service.ts';
import type { ModmailMediaAttachment } from '../modmail/media/types.ts';
import type { ModmailReplyOutbox } from '../modmail/outbox.ts';
import type { ModmailStore } from '../modmail/store.ts';
import { presentRedditModmailTicket } from '../modmail/ticketPresentation.ts';
import type { QuestionEventStore } from '../questions/events.ts';
import type { ReputationStore } from '../reputation/store.ts';
import type { RedditMutationClient } from '../reddit/mutate.ts';
import type { Json } from '../types/json.ts';
import { isMap, parseJson } from '../types/json.ts';

export type RedditInternalHttpCfg = {
  readonly host: string;
  readonly port: number;
  readonly token: string;
};

export type RedditInternalHttpLogger = (line: string) => void;

type ModmailReputationReader = Pick<ReputationStore, 'user'>;
type ModmailCloser = Pick<RedditMutationClient, 'archiveModmail'>;

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

const bodyMap = async (req: Request): Promise<Json | null> => {
  try {
    return parseJson(await req.text());
  } catch {
    return null;
  }
};

const platform = (value: Json | undefined): 'telegram' | 'discord' | null =>
  value === 'telegram' || value === 'discord' ? value : null;

const simpleKey = (value: Json | undefined): string | null =>
  typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/u.test(value) ? value : null;

const conversationId = (value: Json | undefined): string | null =>
  typeof value === 'string' && /^[A-Za-z0-9]+$/u.test(value) ? value : null;

const nonEmptyText = (value: Json | undefined, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 && text.length <= max ? text : null;
};

const optionalText = (value: Json | undefined, max: number): string | null => {
  if (value === undefined) return '';
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length <= max ? text : null;
};

const attachmentIds = (value: Json | undefined): readonly string[] | null => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) return null;
  const ids = value.filter((item): item is string =>
    typeof item === 'string' && /^[A-Za-z0-9_-]{12,128}$/u.test(item));
  return ids.length === value.length ? ids : null;
};

const uploadName = (value: string | null): string | null => {
  if (value === null) return null;
  const name = value.trim();
  return name.length > 0 && name.length <= 180 ? name : null;
};

export class RedditInternalHttpServer {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private modmail: ModmailStore | null = null;
  private modmailReplies: ModmailReplyOutbox | null = null;
  private modmailMedia: ModmailMediaService | null = null;
  private modmailReputation: ModmailReputationReader | null = null;
  private modmailCloser: ModmailCloser | null = null;

  public constructor(
    private readonly cfg: RedditInternalHttpCfg,
    private readonly questions: QuestionEventStore,
    private readonly moderation: ModerationReviewStore,
    private readonly logger: RedditInternalHttpLogger = defaultLogger,
  ) {}

  public useModmail(
    store: ModmailStore,
    replies: ModmailReplyOutbox,
    media: ModmailMediaService,
    reputation: ModmailReputationReader | null = null,
    closer: ModmailCloser | null = null,
  ): void {
    if (this.server !== null) throw new Error('Modmail services must be attached before the Reddit internal API starts');
    this.modmail = store;
    this.modmailReplies = replies;
    this.modmailMedia = media;
    this.modmailReputation = reputation;
    this.modmailCloser = closer;
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
    const text = optionalText(raw['text'], 10_000);
    const ids = attachmentIds(raw['attachmentIds']);
    if (
      key === null || id === null || source === null || userId === null || handle === null
      || text === null || ids === null || (text.length === 0 && ids.length === 0)
    ) {
      return this.record(req, url, json({ error: 'invalid reply body' }, 400));
    }
    const conversation = await this.modmail.conversation(id);
    if (conversation === null) return this.record(req, url, json({ error: 'conversation not found' }, 404));
    if (conversation.state === 'archived') return this.record(req, url, json({ error: 'conversation archived' }, 409));
    let attachments: ModmailMediaAttachment[] = [];
    if (ids.length > 0) {
      if (this.modmailMedia === null) return this.record(req, url, json({ error: 'modmail media unavailable' }, 503));
      try {
        attachments = [...await this.modmailMedia.resolve(id, ids)];
      } catch {
        return this.record(req, url, json({ error: 'invalid or unavailable attachment' }, 400));
      }
    }
    const queued = await this.modmailReplies.queue({
      key,
      conversationId: id,
      moderator: { platform: source, userId, handle },
      text,
      attachments,
    });
    return this.record(req, url, json({ queued: true, reply: queued }, 202), `conversation=${id} key=${key}`);
  }

  private async media(req: Request, url: URL, id: string): Promise<Response> {
    if (this.modmailMedia === null) return this.record(req, url, json({ error: 'modmail media unavailable' }, 503));
    const name = uploadName(req.headers.get('x-mae-file-name'));
    const mimeType = (req.headers.get('content-type') ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
    if (name === null || mimeType.length === 0) return this.record(req, url, json({ error: 'invalid media upload metadata' }, 400));
    try {
      const bytes = new Uint8Array(await req.arrayBuffer());
      const attachment = await this.modmailMedia.upload({ conversationId: id, name, mimeType, bytes });
      return this.record(req, url, json({ attachment }, 201), `conversation=${id} attachment=${attachment.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'media upload failed';
      const status = message.includes('not found') ? 404
        : message.includes('archived') ? 409
          : message.includes('20 MB') || message.includes('Unsupported') || message.includes('filename') ? 400
            : 503;
      return this.record(req, url, json({ error: message }, status), `conversation=${id}`);
    }
  }

  private async archive(req: Request, url: URL, id: string): Promise<Response> {
    if (this.modmail === null || this.modmailCloser === null) {
      return this.record(req, url, json({ error: 'modmail archive unavailable' }, 503));
    }
    const conversation = await this.modmail.conversation(id);
    if (conversation === null) return this.record(req, url, json({ error: 'conversation not found' }, 404));
    if (conversation.state === 'archived') {
      return this.record(req, url, json({ closed: true }), 200, `conversation=${id} already=archived`);
    }
    try {
      await this.modmailCloser.archiveModmail(id);
      return this.record(req, url, json({ closed: true }), 200, `conversation=${id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'modmail archive failed';
      return this.record(req, url, json({ error: message }, 503), `conversation=${id}`);
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

    const archivePath = url.pathname.match(/^\/v1\/modmail\/conversations\/([A-Za-z0-9]+)\/archive$/u);
    if (req.method === 'POST' && archivePath !== null) {
      const id = archivePath[1] ?? '';
      return await this.archive(req, url, id);
    }

    if (req.method === 'GET' && url.pathname.startsWith('/v1/modmail/conversations/')) {
      if (this.modmail === null || this.modmailReplies === null) {
        return this.record(req, url, json({ error: 'modmail unavailable' }, 503));
      }
      const id = decodeURIComponent(url.pathname.slice('/v1/modmail/conversations/'.length)).trim();
      if (!/^[A-Za-z0-9]+$/u.test(id)) return this.record(req, url, json({ error: 'invalid conversation id' }, 400));
      const conversation = await this.modmail.conversation(id);
      if (conversation === null) return this.record(req, url, json({ error: 'conversation not found' }, 404));
      const participant = conversation.participant?.name ?? null;
      const user = participant === null || this.modmailReputation === null
        ? null
        : await this.modmailReputation.user(participant);
      const reputation = user === null
        ? null
        : { username: user.username, points: user.points, tier: user.tier, status: user.status };
      const appliedReplies = await this.modmailReplies.appliedForConversation(id);
      const ticketView = presentRedditModmailTicket(conversation, appliedReplies);
      return this.record(
        req,
        url,
        json({ conversation, reputation, ticketView }),
        `conversation=${id} messages=${conversation.messages.length} reputation=${reputation?.points ?? 'none'}`,
      );
    }

    if (req.method === 'POST' && url.pathname.startsWith('/v1/modmail/media/')) {
      const id = decodeURIComponent(url.pathname.slice('/v1/modmail/media/'.length)).trim();
      if (!/^[A-Za-z0-9]+$/u.test(id)) return this.record(req, url, json({ error: 'invalid conversation id' }, 400));
      return await this.media(req, url, id);
    }
    if (req.method === 'POST' && url.pathname === '/v1/modmail/replies') return await this.reply(req, url);

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
      const source = platform(body['platform']);
      const userId = nonEmptyText(body['userId'], 128);
      const userName = nonEmptyText(body['userName'], 128);
      if (
        typeof key !== 'string'
        || (choice !== 'approve' && choice !== 'reject')
        || source === null
        || userId === null
        || userName === null
      ) {
        return this.record(req, url, json({ error: 'invalid decision body' }, 400));
      }
      const result = await this.moderation.decide(key, {
        choice,
        platform: source,
        userId,
        userName,
        at: Math.floor(Date.now() / 1_000),
      });
      if (result === null) return this.record(req, url, json({ error: 'review not found' }, 404), `review=${key}`);
      return this.record(req, url, json(result), `review=${key} won=${result.won ? 'yes' : 'no'}`);
    }

    return this.record(req, url, json({ error: 'not found' }, 404));
  }
}
