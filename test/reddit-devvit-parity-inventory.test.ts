import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { devvitParity, paritySources } from '../src/reddit/devvitParity.ts';

describe('Devvit migration method inventory', () => {
  for (const [scope, spec] of Object.entries(paritySources)) {
    test('accounts for every public method in ' + spec.className, () => {
      const source = ts.createSourceFile(
        spec.path, readFileSync(spec.path, 'utf8'), ts.ScriptTarget.Latest, true,
      );
      const declaration = source.statements.find(statement =>
        ts.isClassDeclaration(statement) && statement.name?.text === spec.className,
      );
      if (declaration === undefined || !ts.isClassDeclaration(declaration)) {
        throw new Error('Could not find ' + spec.className);
      }
      const methods = declaration.members
        .filter(ts.isMethodDeclaration)
        .filter(method => method.modifiers?.some(mod => mod.kind === ts.SyntaxKind.PublicKeyword))
        .map(method => method.name.getText(source))
        .sort();
      const listed = Object.keys(devvitParity[scope as keyof typeof devvitParity]).sort();
      expect(listed).toEqual(methods);
    });
  }
  test('does not represent staged transport as production parity', () => {
    const values = Object.values(devvitParity).flatMap(group => Object.values(group));
    expect(values).toContain('blocked');
    expect(values).toContain('staged');
    expect(values).not.toContain('verified');
  });
});
