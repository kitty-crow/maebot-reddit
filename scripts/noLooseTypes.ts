import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import ts from 'typescript';

const roots = ['src', 'test', 'scripts'];
const hits: string[] = [];

const inspect = async (file: string): Promise<void> => {
  const raw = await readFile(file, 'utf8');
  const src = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword || node.kind === ts.SyntaxKind.UnknownKeyword) {
      const pos = src.getLineAndCharacterOfPosition(node.getStart(src));
      hits.push(`${file}:${pos.line + 1}:${pos.character + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
};

const scan = async (dir: string): Promise<void> => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) await scan(file);
    else if (extname(file) === '.ts') await inspect(file);
  }
};

for (const root of roots) await scan(root);
if (hits.length > 0) {
  console.error(`Loose TypeScript types found:\n${hits.join('\n')}`);
  process.exit(1);
}
