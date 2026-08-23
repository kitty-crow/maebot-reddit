import { createHash } from 'node:crypto';
import type { ModmailTerminalCfg } from '../env.ts';
import type { Json } from '../types/json.ts';
import { isMap, parseJson } from '../types/json.ts';
import { ModmailReplyOutbox } from './outbox.ts';
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

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="color-scheme" content="dark light">
  <title>Mae · Reddit Modmail</title>
  <style>
    :root { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; color-scheme: dark light; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; grid-template-rows: auto 1fr auto; background: Canvas; color: CanvasText; }
    header { padding: 14px 16px; border-bottom: 1px solid color-mix(in srgb, CanvasText 18%, transparent); }
    h1 { margin: 0; font-size: 1rem; }
    #meta { margin-top: 7px; opacity: .72; font-size: .78rem; white-space: pre-wrap; }
    #messages { overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
    .message { max-width: 86%; padding: 10px 12px; border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 10px; }
    .participant { align-self: flex-start; }
    .moderator { align-self: flex-end; }
    .internal { align-self: center; max-width: 94%; border-style: dashed; opacity: .82; }
    .who { font-weight: 700; font-size: .75rem; margin-bottom: 6px; }
    .body { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.35; }
    .time { margin-top: 7px; opacity: .55; font-size: .68rem; }
    footer { border-top: 1px solid color-mix(in srgb, CanvasText 18%, transparent); padding: 12px; }
    textarea { width: 100%; min-height: 86px; resize: vertical; padding: 10px; font: inherit; border-radius: 8px; border: 1px solid color-mix(in srgb, CanvasText 25%, transparent); background: Canvas; color: CanvasText; }
    .actions { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
    button { font: inherit; padding: 9px 12px; border-radius: 8px; border: 1px solid color-mix(in srgb, CanvasText 25%, transparent); cursor: pointer; }
    #send { font-weight: 700; }
    #status { flex: 1; min-width: 0; opacity: .72; font-size: .75rem; }
    button:disabled, textarea:disabled { opacity: .5; cursor: not-allowed; }
  </style>
</head>
<body>
  <header>
    <h1>Mae · Reddit Modmail</h1>
    <div id="meta">Opening conversation…</div>
  </header>
  <main id="messages" aria-live="polite"></main>
  <footer>
    <textarea id="composer" maxlength="10000" placeholder="Reply to the Reddit user"></textarea>
    <div class="actions">
      <button id="send" type="button">Send to Reddit</button>
      <button id="close" type="button">Close terminal</button>
      <span id="status"></span>
    </div>
  </footer>
<script>
(() => {
  'use strict';
  const base = location.pathname.replace(/\/$/, '');
  const meta = document.getElementById('meta');
  const messages = document.getElementById('messages');
  const composer = document.getElementById('composer');
  const send = document.getElementById('send');
  const close = document.getElementById('close');
  const status = document.getElementById('status');
  let lastSignature = '';
  let moderator = null;
  let closed = false;

  const setEnabled = enabled => {
    composer.disabled = !enabled;
    send.disabled = !enabled;
  };

  const roleFor = (message, participant) => {
    if (message.isInternal) return 'internal';
    const author = (message.author && message.author.name || '').toLowerCase();
    return participant && author === participant.toLowerCase() ? 'participant' : 'moderator';
  };

  const render = payload => {
    const conversation = payload.conversation;
    moderator = payload.moderator;
    if (!conversation) return;
    const participant = conversation.participant && conversation.participant.name || '[deleted]';
    meta.textContent = 'u/' + participant + ' · r/' + conversation.subreddit + '\n' + (conversation.subject || '(no subject)') + '\nReplying as ' + moderator.handle + ' via ' + moderator.platform;
    const signature = JSON.stringify(conversation.messages.map(message => [message.id, message.bodyMarkdown, message.isInternal]));
    if (signature !== lastSignature) {
      lastSignature = signature;
      messages.replaceChildren();
      for (const message of conversation.messages) {
        const box = document.createElement('article');
        const role = roleFor(message, participant);
        box.className = 'message ' + role;
        const who = document.createElement('div');
        who.className = 'who';
        const name = message.author && message.author.name || '[deleted]';
        who.textContent = message.isInternal ? 'Internal moderator note · ' + name : name;
        const body = document.createElement('div');
        body.className = 'body';
        body.textContent = message.bodyMarkdown || '';
        const time = document.createElement('div');
        time.className = 'time';
        time.textContent = message.createdAt > 0 ? new Date(message.createdAt * 1000).toLocaleString() : '';
        box.append(who, body, time);
        messages.append(box);
      }
      messages.scrollTop = messages.scrollHeight;
    }
    if (conversation.state === 'archived') {
      closed = true;
      setEnabled(false);
      status.textContent = 'This Reddit conversation is archived.';
    } else if (!closed) {
      setEnabled(true);
    }
  };

  const events = new EventSource(base + '/stream');
  events.onmessage = event => {
    try { render(JSON.parse(event.data)); }
    catch { status.textContent = 'Could not read a conversation update.'; }
  };
  events.addEventListener('closed', () => {
    closed = true;
    setEnabled(false);
    status.textContent = 'This temporary terminal has closed.';
    events.close();
  });
  events.onerror = () => {
    if (!closed) status.textContent = 'Connection interrupted; reconnecting…';
  };

  send.addEventListener('click', async () => {
    const text = composer.value.trim();
    if (!text || closed) return;
    send.disabled = true;
    status.textContent = 'Queueing reply…';
    const requestId = crypto.randomUUID();
    try {
      const response = await fetch(base + '/reply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId, text })
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      composer.value = '';
      status.textContent = 'Reply queued for Reddit.';
    } catch {
      status.textContent = 'Reply was not queued. Your text has been kept.';
    } finally {
      if (!closed) send.disabled = false;
    }
  });

  close.addEventListener('click', async () => {
    if (closed) return;
    closed = true;
    setEnabled(false);
    await fetch(base + '/close', { method: 'POST' }).catch(() => undefined);
    events.close();
    status.textContent = 'Terminal access closed. You can close this window.';
    if (window.Telegram && window.Telegram.WebApp && typeof window.Telegram.WebApp.close === 'function') {
      window.Telegram.WebApp.close();
    }
  });
})();
</script>
</body>
</html>`;

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
    const path = tokenFrom(url.pathname);
    if (path === null) return json({ error: 'not found' }, 404);
    const session = await this.store.terminalSession(path.token);
    if (session === null) return json({ error: 'terminal session unavailable' }, 404);

    if (req.method === 'GET' && path.action === '') {
      return new Response(html, { status: 200, headers: pageHeaders() });
    }
    if (req.method === 'GET' && path.action === 'stream') return await this.stream(path.token);
    if (req.method === 'POST' && path.action === 'reply') return await this.reply(req, path.token);
    if (req.method === 'POST' && path.action === 'close') return await this.close(path.token);
    return json({ error: 'not found' }, 404);
  }
}
