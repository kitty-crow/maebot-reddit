import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

export type SnapshotFile = {
  readonly source: string;
  readonly destination: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly sha256: string;
};

export type SnapshotManifest = {
  readonly createdAt: string;
  readonly redditRoot: string;
  readonly commonRoot: string | null;
  readonly files: readonly SnapshotFile[];
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const hash = async (path: string): Promise<string> => createHash('sha256').update(await readFile(path)).digest('hex');

const copyOne = async (source: string, destination: string): Promise<SnapshotFile> => {
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  const info = await stat(source);
  return {
    source,
    destination,
    size: info.size,
    mtimeMs: info.mtimeMs,
    sha256: await hash(source),
  };
};

const filesUnder = async (root: string): Promise<readonly string[]> => {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) out.push(path);
    }
  };
  if (await exists(root)) await walk(root);
  return out.sort();
};

const required = (value: string | undefined, usage: string): string => {
  if (value === undefined || value.trim().length === 0) throw new Error(usage);
  return value;
};

const usage = 'Usage: bun run scripts/legacySnapshot.ts <legacy-reddit-dir> <new-snapshot-dir> [legacy-common-dir]';
const sourceArg = required(process.argv[2], usage);
const outArg = required(process.argv[3], usage);
const commonArg = process.argv[4];
const source = await realpath(resolve(sourceArg));
const output = resolve(outArg);
const common = commonArg === undefined ? null : await realpath(resolve(commonArg));

if (!isAbsolute(output)) throw new Error('Snapshot destination must resolve to an absolute path');
const fromSource = relative(source, output);
if (fromSource === '' || !fromSource.startsWith('..')) {
  throw new Error('Snapshot destination must not be inside the legacy Reddit source tree');
}
if (await exists(output)) throw new Error(`Snapshot destination already exists: ${output}`);
await mkdir(output, { recursive: false });

const candidates = [
  'database.db',
  'database_backup.db',
  'database - Copy.db',
  'pairs.csv',
  'submission_moderation/database.db',
  'submission_moderation/database - Copy.db',
  'submission_moderation/database_reduild.py',
] as const;

const manifest: SnapshotFile[] = [];
for (const rel of candidates) {
  const from = join(source, rel);
  if (await exists(from)) manifest.push(await copyOne(from, join(output, 'reddit', rel)));
}

const haikuRoot = join(source, 'Haikus');
for (const from of await filesUnder(haikuRoot)) {
  manifest.push(await copyOne(from, join(output, 'reddit', 'Haikus', relative(haikuRoot, from))));
}

if (common !== null) {
  for (const name of ['database.py', 'database.db', 'logprint.py']) {
    const from = join(common, name);
    if (await exists(from)) manifest.push(await copyOne(from, join(output, 'common', basename(from))));
  }
}

const result: SnapshotManifest = {
  createdAt: new Date().toISOString(),
  redditRoot: source,
  commonRoot: common,
  files: manifest,
};
await writeFile(join(output, 'manifest.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(`Created read-only legacy snapshot copy with ${manifest.length} file(s) at ${output}`);
