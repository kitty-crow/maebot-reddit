import { createHash } from 'node:crypto';
import type { ModmailTerminalCfg } from '../env.ts';
import type { Json } from '../types/json.ts';
import { isMap, parseJson } from '../types/json.ts';
import { ModmailReplyOutbox } from './outbox.ts';
import { modmailTerminalPage } from './terminalPage.ts';
import { ModmailStore } from './store.ts';
import type { ModmailModeratorIdentity, ModmailTerminalSession } from './types.ts';

export type ModmailTerminalLink = {
  readonly url: string;
  readonly expiresAt: number;
};

type TerminalClient = {
  readonly conversationId: string;
  readonly expiresAt: number;
  readonly controller: ReadableStreamDefaultController<Uint8Array>;
};

const encoder = new TextEncoder();

const pageHeaders = (): Headers => new Headers({
  'cache-control': 'no-store, private',
  'content-security-policy': "default-src 'none'; connect-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
  'content-type': 'text/html; charset=utf-8',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
});

const json = (value: object, status = 200): Response => new Response(JSON.stringify(value), {
  status,
  headers: {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'referrer-policy': 'no-referrer',
  },
});

const tokenFrom = (pathname: string): { readonly token: string; readonly action: string } | null => {
  const match = pathname.match(/^\/modmail\/([A-Za-z0-9_-]{24,})\/(?:([^/]+))?$/u);
  if (match === null) return null;
  const token = match[1] ?? '';
  const action = match[2] ?? '';
  return token.length > 0 ? { token, action } : null;
};

const requestId = (value: Json | undefined): string | null =>
  typeof value === 'string' && /^[A-Za-z0-9._:-]{8,128}$/u.test(value) ? value : null;

const safeHandle = (value: string): string => value.trim().slice(0, 128);

export class ModmailTerminalServer {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly clients = new Map<string, Set<TerminalClient>>();

  public constructor(
    private readonly cfg: ModmailTerminalCfg,
    private readonly store: ModmailStore,
    private readonly outbox: ModmailReplyOutbox,
  ) {}

  public start(): void {
    if (this.server !== null) return;
    this.unsubscribe = this.store.subscribe(ids => this.publish(ids));
    this.server = Bun.serve({
      hostname: this.cfg.host,
      port: this.cfg.port,
      fetch: req => this.route(req),
    });
    this.timer = setInterval(() => this.heartbeat(), 20_000);
  }

  public stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const clients of this.clients.values()) {
      for (const client of clients) this.closeClient(client);
    }
    this.clients.clear();
    this.server?.stop();
    this.server = null;
  }

  public address(): string {
    const server = this.server;
    if (server === null) throw new Error('Modmail terminal server is not running');
    const host = this.cfg.host === '::1' ? '[::1]' : this.cfg.host;
    return `http://${host}:${server.port}`;
  }

  public previewAddress(): string {
    return `${this.address()}/preview/`;
  }

  public async issue(conversationId: string, moderator: ModmailModeratorIdentity): Promise<ModmailTerminalLink> {
    if (safeHandle(moderator.handle).length === 0) throw new Error('Moderator handle is required');
    const session = await this.store.createTerminalSession(
      conversationId,
      { ...moderator, handle: safeHandle(moderator.handle) },
      this.cfg.ttlSeconds,
    );
    const base = this.cfg.publicBase.endsWith('/') ? this.cfg.publicBase : `${this.cfg.publicBase}/`;
    return {
      url: new URL(`modmail/${encodeURIComponent(session.token)}/`, base).toString(),
      expiresAt: session.expiresAt,
    };
  }

  private removeClient(token: string, client: TerminalClient): void {
    const values = this.clients.get(token);
    values?.delete(client);
    if (values?.size === 0) this.clients.delete(token);
  }

  private closeClient(client: TerminalClient): void {
    try { client.controller.enqueue(encoder.encode('event: closed\ndata: {}\n\n')); } catch { /* already disconnected */ }
    try { client.controller.close(); } catch { /* already closed */ }
  }

  private async snapshot(token: string): Promise<{ readonly session: ModmailTerminalSession; readonly payload: object } | null> {
    const session = await this.store.terminalSession(token);
    if (session === null) return null;
    const conversation = await this.store.conversation(session.conversationId);
    if (conversation === null) return null;
    return { session, payload: { conversation, moderator: session.moderator, expiresAt: session.expiresAt } };
  }

  private async writeSnapshot(token: string, client: TerminalClient): Promise<void> {
    const value = await this.snapshot(token);
    if (value === null) {
      this.closeClient(client);
      this.removeClient(token, client);
      return;
    }
    try {
      client.controller.enqueue(encoder.encode(`data: ${JSON.stringify(value.payload)}\n\n`));
    } catch {
      this.removeClient(token, client);
    }
  }

  private async publish(conversationIds: readonly string[]): Promise<void> {
    const changed = new Set(conversationIds);
    for (const [token, clients] of this.clients) {
      const first = clients.values().next().value as TerminalClient | undefined;
      if (first === undefined || !changed.has(first.conversationId)) continue;
      for (const client of [...clients]) await this.writeSnapshot(token, client);
    }
  }

  private heartbeat(): void {
    const now = Math.floor(Date.now() / 1_000);
    for (const [token, clients] of this.clients) {
      for (const client of [...clients]) {
        if (client.expiresAt <= now) {
          this.closeClient(client);
          this.removeClient(token, client);
          continue;
        }
        try { client.controller.enqueue(encoder.encode(': keepalive\n\n')); }
        catch { this.removeClient(token, client); }
      }
    }
  }

  private async stream(token: string): Promise<Response> {
    const value = await this.snapshot(token);
    if (value === null) return json({ error: 'terminal session unavailable' }, 404);
    let client: TerminalClient | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start: controller => {
        client = {
          conversationId: value.session.conversationId,
          expiresAt: value.session.expiresAt,
          controller,
        };
        const values = this.clients.get(token) ?? new Set<TerminalClient>();
        values.add(client);
        this.clients.set(token, values);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(value.payload)}\n\n`));
      },
      cancel: () => {
        if (client !== null) this.removeClient(token, client);
      },
    });
    return new Response(stream, {
      headers: {
        'cache-control': 'no-cache, no-store',
        'content-type': 'text/event-stream; charset=utf-8',
        'referrer-policy': 'no-referrer',
        'x-accel-buffering': 'no',
        'x-content-type-options': 'nosniff',
      },
    });
  }

  private async reply(req: Request, token: string): Promise<Response> {
    const session = await this.store.terminalSession(token);
    if (session === null) return json({ error: 'terminal session unavailable' }, 404);
    const raw = parseJson(await req.text());
    if (!isMap(raw)) return json({ error: 'invalid reply body' }, 400);
    const id = requestId(raw['requestId']);
    const text = typeof raw['text'] === 'string' ? raw['text'].trim() : '';
    if (id === null || text.length === 0 || text.length > 10_000) return json({ error: 'invalid reply body' }, 400);
    const tokenHash = createHash('sha256').update(token).digest('hex').slice(0, 24);
    const queued = await this.outbox.queue({
      key: `terminal:${tokenHash}:${id}`,
      conversationId: session.conversationId,
      moderator: session.moderator,
      text,
    });
    return json({ queued: true, key: queued.key }, 202);
  }

  private async close(token: string): Promise<Response> {
    await this.store.closeTerminalSession(token);
    const clients = this.clients.get(token);
    if (clients !== undefined) for (const client of [...clients]) this.closeClient(client);
    this.clients.delete(token);
    return json({ closed: true });
  }

  private async route(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/health') return json({ ok: true });
    if (req.method === 'GET' && (url.pathname === '/preview' || url.pathname === '/preview/')) {
      return new Response(modmailTerminalPage, { status: 200, headers: pageHeaders() });
    }

    const path = tokenFrom(url.pathname);
    if (path === null) return json({ error: 'not found' }, 404);
    const session = await this.store.terminalSession(path.token);
    if (session === null) return json({ error: 'terminal session unavailable' }, 404);

    if (req.method === 'GET' && path.action === '') {
      return new Response(modmailTerminalPage, { status: 200, headers: pageHeaders() });
    }
    if (req.method === 'GET' && path.action === 'stream') return await this.stream(path.token);
    if (req.method === 'POST' && path.action === 'reply') return await this.reply(req, path.token);
    if (req.method === 'POST' && path.action === 'close') return await this.close(path.token);
    return json({ error: 'not found' }, 404);
  }
}
