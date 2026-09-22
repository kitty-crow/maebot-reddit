import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const roots = ['src', 'scripts', 'test'];
const activeRoots = new Set(['src', 'scripts']);
const forbidden: readonly {
  readonly pattern: RegExp;
  readonly reason: string;
  readonly activeOnly?: boolean;
}[] = [
  { pattern: /twitter\.pb/iu, reason: 'Reddit must not open canonical Twitter storage' },
  { pattern: /FxTwitter/iu, reason: 'Reddit must not instantiate a Twitter watcher' },
  { pattern: /dailyReview\.pb/iu, reason: 'Reddit must not open Telegram Daily Review storage' },
  { pattern: /dailyTask\.pb/iu, reason: 'Reddit must not open Telegram Daily Task storage' },
  { pattern: /vendor\/maebot-telegram\/src/iu, reason: 'Reddit must not import Telegram implementation internals' },
  { pattern: /from ['"]discord\.js['"]/u, reason: 'Reddit must not own Discord presentation' },
  { pattern: /node-telegram-bot-api/iu, reason: 'Reddit must not own Telegram presentation' },
  { pattern: /DISCORD_(TOKEN|MAE_TOKEN|SERVER_ID)/u, reason: 'Reddit must not own Discord credentials' },
  { pattern: /TELEGRAM_(TOKEN|BOT_TOKEN)/u, reason: 'Reddit must not own Telegram credentials' },
  { pattern: /mae\.kittycrow\.dev/iu, reason: 'Mae Reddit must not depend on the Mae Tickets public hostname' },
  { pattern: /REDDIT_DEVVIT_(?:INGRESS_HOST|INGRESS_PORT)/u, reason: 'Devvit must not add a second Mae Reddit listener' },
  { pattern: /REDDIT_DEVVIT_BRIDGE_SECRET/u, reason: 'The local Devvit adapter must use the existing internal API trust boundary' },
  { pattern: /REDDIT_DEVVIT_RPC_STATE_FILE/u, reason: 'Devvit transport must not add a canonical RPC spool store' },
  { pattern: /DevvitRpcSpool/u, reason: 'Devvit transport must not add a durable RPC spool subsystem' },
  { pattern: /ModmailTerminalServer/u, reason: 'Reddit must not host the extracted Mae Tickets browser/server', activeOnly: true },
  { pattern: /modmailTerminalConfig/u, reason: 'Reddit must not configure the extracted Mae Tickets browser/server', activeOnly: true },
  { pattern: /\/v1\/modmail\/terminal-sessions/u, reason: 'Reddit must not expose legacy terminal-session authority', activeOnly: true },
  { pattern: /vendor\/mae-tickets\/src/iu, reason: 'Reddit must not import Mae Tickets implementation internals', activeOnly: true },
];

const adapterForbidden: readonly {
  readonly pattern: RegExp;
  readonly reason: string;
}[] = [
  { pattern: /(?:^|[\\/])src[\\/](?:mod|modmail|reputation|twitter|dm|questions)[\\/]/iu, reason: 'Devvit adapter must not import Mae business modules' },
  { pattern: /(?:mae\.kittycrow\.dev|REDDIT_INTERNAL_API_|REDDIT_DEVVIT_|DevvitRpcSpool)/iu, reason: 'Devvit adapter must not know Mae transport configuration or failed migration scaffolding' },
  { pattern: /(?:Discord|Telegram|Mae Tickets|mae-tickets|twitter\.pb|reputation\.pb)/iu, reason: 'Devvit adapter must remain generic and platform-only' },
  { pattern: /from\s+['"]@devvit\/[^'"]*(?:redis|scheduler|settings)[^'"]*['"]/iu, reason: 'Generic Devvit adapter must not import Devvit persistence, scheduling, or settings services' },
];

const allowedDevvitServerImports = new Set(['reddit']);
const devvitServerImport = /import\s*\{([\s\S]*?)\}\s*from\s*['"]@devvit\/web\/server['"]/gu;

const checkDevvitServerImports = (raw: string, path: string): void => {
  for (const match of raw.matchAll(devvitServerImport)) {
    const clause = match[1] ?? '';
    for (const part of clause.split(',')) {
      const cleaned = part.trim().replace(/^type\s+/u, '');
      if (cleaned.length === 0) continue;
      const imported = cleaned.split(/\s+as\s+/u)[0]?.trim() ?? '';
      if (!allowedDevvitServerImports.has(imported)) {
        hits.push(
          `${path}: Devvit runtime may import only reddit from @devvit/web/server; found ${imported || '<invalid import>'}`,
        );
      }
    }
  }
};

const forbiddenDevvitRuntimeWiring = [
  /from\s+['"]\.\/controller\.ts['"]/u,
  /from\s+['"]\.\/legacyAdapter\.ts['"]/u,
  /from\s+['"]\.\/legacyCompat\.ts['"]/u,
  /from\s+['"]\.\/legacyMutationCompat\.ts['"]/u,
  /\/api\/controller/u,
  /\/api\/reddit/u,
];

const forbiddenActivePaths = [
  /^src[\\/]modmail[\\/]terminalServer\.ts$/iu,
  /^src[\\/]modmail[\\/]terminalPage(?:View)?\.(?:ts|tsx)$/iu,
  /^src[\\/]modmail[\\/]web(?:[\\/]|$)/iu,
];

const hits: string[] = [];
const sourceFile = (file: string): boolean => {
  const extension = extname(file);
  return extension === '.ts' || extension === '.tsx';
};

const scan = async (dir: string, active: boolean): Promise<void> => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) {
      await scan(file, active);
      continue;
    }
    if (!sourceFile(file)) continue;
    const path = relative(process.cwd(), file);
    if (active && forbiddenActivePaths.some(pattern => pattern.test(path))) {
      hits.push(`${path}: Reddit must not contain the extracted Mae Tickets browser/server implementation`);
    }
    if (file.endsWith('architectureBoundaries.ts')) continue;
    const raw = await readFile(file, 'utf8');
    for (const rule of forbidden) {
      if (rule.activeOnly === true && !active) continue;
      if (rule.pattern.test(raw)) hits.push(`${path}: ${rule.reason}`);
    }
    if (active && /deprecated[\\/]legacy-python/iu.test(raw)) {
      hits.push(`${path}: active TypeScript must not depend on deprecated legacy Python code`);
    }
    if (active && /Bun\.serve\s*\(/u.test(raw) && path !== 'src/http/server.ts') {
      hits.push(`${path}: Mae Reddit must keep a single Bun listener in src/http/server.ts`);
    }
  }
};

const checkMinimalDevvitRuntime = async (): Promise<void> => {
  const indexPath = 'devvit/src/server/index.ts';
  const raw = await readFile(indexPath, 'utf8');
  for (const pattern of forbiddenDevvitRuntimeWiring) {
    if (pattern.test(raw)) {
      hits.push(`${indexPath}: Devvit runtime must remain presence-only; compatibility/controller wiring is dormant`);
    }
  }

  const configPath = 'devvit/devvit.json';
  const config = await readFile(configPath, 'utf8');
  if (/"media"\s*:/u.test(config)) {
    hits.push(`${configPath}: Devvit media permission must remain disabled`);
  }
};

const scanAdapter = async (dir: string): Promise<void> => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanAdapter(file);
      continue;
    }
    if (!sourceFile(file)) continue;
    const path = relative(process.cwd(), file);
    const raw = await readFile(file, 'utf8');
    checkDevvitServerImports(raw, path);
    for (const rule of adapterForbidden) {
      if (rule.pattern.test(raw)) hits.push(`${path}: ${rule.reason}`);
    }
  }
};

for (const root of roots) await scan(root, activeRoots.has(root));
try {
  await scanAdapter('devvit/src');
  await checkMinimalDevvitRuntime();
} catch (error) {
  const code = error instanceof Error && 'code' in error ? Reflect.get(error, 'code') : null;
  if (code !== 'ENOENT') throw error;
}

if (hits.length > 0) {
  console.error(`Architecture boundary violations:\n${hits.join('\n')}`);
  process.exit(1);
}
