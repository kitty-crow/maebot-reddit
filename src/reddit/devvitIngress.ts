import type { DevvitRpcResult } from './devvitRpc.ts';
import { DevvitRpcSpool } from './devvitRpc.ts';

export type DevvitIngressCfg = {
  readonly host: string;
  readonly port: number;
  readonly secret: string;
};

const json = (value: object, status = 200): Response => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
});

const result = (value: unknown): DevvitRpcResult | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = record['id'];
  const ok = record['ok'];
  if (typeof id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(id) || typeof ok !== 'boolean') return null;
  const error = record['error'];
  return {
    id,
    ok,
    ...(record['value'] === undefined ? {} : { value: record['value'] as DevvitRpcResult['value'] }),
    ...(typeof error === 'string' ? { error } : {}),
  };
};

export class RedditDevvitIngressServer {
  private server: ReturnType<typeof Bun.serve> | null = null;

  public constructor(
    private readonly cfg: DevvitIngressCfg,
    private readonly spool: DevvitRpcSpool,
  ) {}

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
    if (server === null) throw new Error('Devvit ingress is not running');
    const host = this.cfg.host === '::1' ? '[::1]' : this.cfg.host;
    return `http://${host}:${server.port}`;
  }

  private authorised(req: Request): boolean {
    return req.headers.get('authorization') === `Bearer ${this.cfg.secret}`;
  }

  private async route(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/health') return json({ ok: true });
    if (!this.authorised(req)) return json({ error: 'unauthorised' }, 401);

    if (req.method === 'GET' && url.pathname === '/v1/devvit/work') {
      const rawLimit = url.searchParams.get('limit');
      const limit = rawLimit === null ? 25 : Number(rawLimit);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) return json({ error: 'invalid limit' }, 400);
      return json({ commands: await this.spool.lease(limit) });
    }

    if (req.method === 'POST' && url.pathname === '/v1/devvit/result') {
      let parsed: unknown;
      try {
        parsed = await req.json();
      } catch {
        return json({ error: 'invalid json' }, 400);
      }
      const input = result(parsed);
      if (input === null) return json({ error: 'invalid result' }, 400);
      await this.spool.complete(input);
      return json({ ok: true });
    }

    return json({ error: 'not found' }, 404);
  }
}
