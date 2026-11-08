import ts from 'typescript';

export type SourceViolation = {
  readonly file: string;
  readonly line: number;
  readonly reason: 'explicit any' | 'explicit unknown' | 'nested if' | 'JavaScript source';
};

const sourceType = /\.(?:ts|tsx|mts|cts)$/iu;
const javascriptType = /\.(?:js|jsx|mjs|cjs)$/iu;

export const checkSource = (file: string, content: string): readonly SourceViolation[] => {
  if (javascriptType.test(file)) return [{ file, line: 1, reason: 'JavaScript source' }];
  if (!sourceType.test(file) || file.endsWith('.d.ts')) return [];

  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const violations: SourceViolation[] = [];
  const report = (node: ts.Node, reason: SourceViolation['reason']): void => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    violations.push({ file, line: line + 1, reason });
  };
  const visit = (node: ts.Node, insideIf: boolean): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) report(node, 'explicit any');
    if (node.kind === ts.SyntaxKind.UnknownKeyword) report(node, 'explicit unknown');
    if (ts.isIfStatement(node) && insideIf) report(node, 'nested if');
    const nested = ts.isFunctionLike(node) ? false : insideIf || ts.isIfStatement(node);
    ts.forEachChild(node, child => visit(child, nested));
  };
  visit(source, false);
  return violations;
};
