import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import ts from 'typescript';

const roots = ['src', 'test', 'scripts'];
const hits: string[] = [];

const sourceExtension = (file: string): '.ts' | '.tsx' | null => {
  const extension = extname(file);
  if (extension === '.ts' || extension === '.tsx') return extension;
  return null;
};

const inspect = async (file: string, extension: '.ts' | '.tsx'): Promise<void> => {
  const raw = await readFile(file, 'utf8');
  const kind = extension === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const src = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true, kind);
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
    if (entry.isDirectory()) {
      await scan(file);
      continue;
    }
    const extension = sourceExtension(file);
    if (extension !== null) await inspect(file, extension);
  }
};

for (const root of roots) await scan(root);
if (hits.length > 0) {
  console.error(`Loose TypeScript types found:\n${hits.join('\n')}`);
  process.exit(1);
}
