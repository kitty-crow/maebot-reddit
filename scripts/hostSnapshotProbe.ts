import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

type SnapshotFile = {
  readonly source: string;
  readonly destination: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly sha256: string;
};

type SnapshotManifest = {
  readonly createdAt: string;
  readonly redditRoot: string;
  readonly commonRoot: string | null;
  readonly files: readonly SnapshotFile[];
};

const sha256 = async (path: string): Promise<string> =>
  createHash('sha256').update(await readFile(path)).digest('hex');

const rootArg = process.argv[2];
if (rootArg === undefined || rootArg.trim().length === 0) {
  console.error('Usage: bun run scripts/hostSnapshotProbe.ts <snapshot-dir>');
  process.exit(2);
}

const root = await realpath(resolve(rootArg));
const manifestPath = resolve(root, 'manifest.json');
const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as SnapshotManifest;
if (!Array.isArray(parsed.files)) throw new Error('Snapshot manifest files must be an array');
if (Number.isNaN(Date.parse(parsed.createdAt))) throw new Error('Snapshot manifest timestamp is invalid');

const required = new Set([
  'reddit/database.db',
  'reddit/submission_moderation/database.db',
  'reddit/pairs.csv',
  'reddit/submission_moderation/database_reduild.py',
]);
const seen = new Set<string>();
let haikus = 0;

for (const entry of parsed.files) {
  const destination = await realpath(entry.destination);
  if (!isAbsolute(destination)) throw new Error(`Snapshot destination is not absolute: ${entry.destination}`);
  const rel = relative(root, destination).replaceAll('\\', '/');
  if (rel === '' || rel.startsWith('../') || rel === '..') {
    throw new Error(`Snapshot file escaped the disposable snapshot root: ${entry.destination}`);
  }
  const info = await stat(destination);
  if (info.size !== entry.size) throw new Error(`Snapshot size mismatch: ${rel}`);
  const digest = await sha256(destination);
  if (digest !== entry.sha256) throw new Error(`Snapshot SHA-256 mismatch: ${rel}`);
  seen.add(rel);
  if (rel.startsWith('reddit/Haikus/')) haikus += 1;
}

for (const path of required) {
  if (!seen.has(path)) throw new Error(`Required live Reddit fixture is missing from snapshot: ${path}`);
}

console.log(`Verified ${seen.size} copied live Reddit fixture file(s).`);
console.log(`Copied Haiku files: ${haikus}.`);
console.log('Snapshot verification did not read or print fixture contents.');
