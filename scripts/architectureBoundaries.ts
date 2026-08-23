import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const roots = ['src', 'scripts', 'test'];
const activeRoots = new Set(['src', 'scripts']);
const forbidden: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
  { pattern: /twitter\.pb/iu, reason: 'Reddit must not open canonical Twitter storage' },
  { pattern: /FxTwitter/iu, reason: 'Reddit must not instantiate a Twitter watcher' },
  { pattern: /dailyReview\.pb/iu, reason: 'Reddit must not open Telegram Daily Review storage' },
  { pattern: /dailyTask\.pb/iu, reason: 'Reddit must not open Telegram Daily Task storage' },
  { pattern: /vendor\/maebot-telegram\/src/iu, reason: 'Reddit must not import Telegram implementation internals' },
  { pattern: /from ['"]discord\.js['"]/u, reason: 'Reddit must not own Discord presentation' },
  { pattern: /node-telegram-bot-api/iu, reason: 'Reddit must not own Telegram presentation' },
  { pattern: /DISCORD_(TOKEN|MAE_TOKEN|SERVER_ID)/u, reason: 'Reddit must not own Discord credentials' },
  { pattern: /TELEGRAM_(TOKEN|BOT_TOKEN)/u, reason: 'Reddit must not own Telegram credentials' },
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
    if (file.endsWith('architectureBoundaries.ts')) continue;
    const raw = await readFile(file, 'utf8');
    for (const rule of forbidden) {
      if (rule.pattern.test(raw)) hits.push(`${relative(process.cwd(), file)}: ${rule.reason}`);
    }
    if (active && /deprecated[\\/]legacy-python/iu.test(raw)) {
      hits.push(`${relative(process.cwd(), file)}: active TypeScript must not depend on deprecated legacy Python code`);
    }
  }
};

for (const root of roots) await scan(root, activeRoots.has(root));
if (hits.length > 0) {
  console.error(`Architecture boundary violations:\n${hits.join('\n')}`);
  process.exit(1);
}
