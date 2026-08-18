import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const files = async (root: string): Promise<string[]> => {
  const out: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) out.push(...await files(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
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
      if (path !== undefined && !path.endsWith('.ts') && !path.endsWith('.json')) bad.push(`${file}: ${path}`);
    }
  }
}

if (bad.length > 0) {
  console.error('Relative imports must use explicit .ts extensions:');
  for (const line of bad) console.error(line);
  process.exit(1);
}
