import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkSource, type SourceViolation } from './sourceGuard.ts';

const roots = ['src', 'scripts', 'test', 'devvit/src', 'devvit/test'];
const violations: SourceViolation[] = [];

const scan = async (directory: string): Promise<void> => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = join(directory, entry.name);
    if (entry.isDirectory()) {
      await scan(filename);
      continue;
    }
    const content = await readFile(filename, 'utf8');
    violations.push(...checkSource(filename, content));
  }
};

for (const root of roots) await scan(root);
if (violations.length > 0) {
  for (const issue of violations) {
    console.error(issue.file + ':' + issue.line + ': ' + issue.reason);
  }
  process.exitCode = 1;
} else {
  console.log('Source guard passed: strict types, no nested if statements, TypeScript-only');
}
