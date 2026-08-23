import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const sourceExtension = (name: string): boolean => {
  const extension = extname(name);
  return extension === '.ts' || extension === '.tsx';
};

const files = async (root: string): Promise<string[]> => {
  const out: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) out.push(...await files(full));
    else if (entry.isFile() && sourceExtension(entry.name)) out.push(full);
  }
  return out;
};

const bad: string[] = [];
const spec = /(?:from\s+|import\s*)['"](\.{1,2}\/[^'"]+)['"]/gu;
for (const root of ['src', 'scripts', 'test']) {
  for (const file of await files(root)) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(spec)) {
      const path = match[1];
      if (
        path !== undefined
        && !path.endsWith('.ts')
        && !path.endsWith('.tsx')
        && !path.endsWith('.json')
      ) bad.push(`${file}: ${path}`);
    }
  }
}

if (bad.length > 0) {
  console.error('Relative imports must use explicit .ts, .tsx or .json extensions:');
  for (const line of bad) console.error(line);
  process.exit(1);
}
