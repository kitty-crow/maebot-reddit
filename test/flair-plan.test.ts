import { describe, expect, test } from 'bun:test';
import { planFlairMigration, type LogicalFlairMapping } from '../src/flair/plan.ts';
import type { RedditFlairAssignment, RedditFlairTemplate } from '../src/reddit/types.ts';

const template = (id: string, text: string, cssClass: string | null = null): RedditFlairTemplate => ({
  id,
  text,
  cssClass,
  textColour: 'dark',
  backgroundColour: '#ffffff',
  modOnly: false,
  textEditable: false,
  allowableContent: 'all',
  maxEmojis: 10,
});

const assignment = (
  username: string,
  templateId: string | null,
  text: string | null,
  cssClass: string | null,
): RedditFlairAssignment => ({ username, templateId, text, cssClass });

const mapping = (kind: 'user' | 'post', logicalId: string, sourceTemplateId: string): LogicalFlairMapping => ({
  kind,
  logicalId,
  sourceTemplateId,
});

describe('flair migration dry-run planner', () => {
  test('reuses one semantic destination match and never treats the source UUID as portable', () => {
    const source = template('source-user-id', 'Catgirl', 'h');
    const target = template('target-user-id', 'Catgirl', 'h');
    const plan = planFlairMigration({
      sourceUserTemplates: [source],
      sourcePostTemplates: [],
      sourceAssignments: [assignment('Alice', source.id, source.text, source.cssClass)],
      targetUserTemplates: [target],
      targetPostTemplates: [],
      targetAssignments: [],
      mappings: [mapping('user', 'user:community:catgirl', source.id)],
      warnedUsers: new Set(),
      bannedUsers: new Set(),
    });

    expect(plan.userTemplates[0]?.action).toBe('reuse');
    expect(plan.userTemplates[0]?.targetTemplateId).toBe('target-user-id');
    expect(plan.userTemplates[0]?.targetTemplateId).not.toBe('source-user-id');
    expect(plan.assignments[0]).toMatchObject({
      username: 'Alice',
      logicalId: 'user:community:catgirl',
      targetTemplateId: 'target-user-id',
      action: 'assign',
    });
  });

  test('plans creation when no destination template matches and blocks assignments until creation has an ID', () => {
    const source = template('source-warned', 'Warned', 'w');
    const plan = planFlairMigration({
      sourceUserTemplates: [source],
      sourcePostTemplates: [],
      sourceAssignments: [assignment('Alice', source.id, source.text, source.cssClass)],
      targetUserTemplates: [],
      targetPostTemplates: [],
      targetAssignments: [],
      mappings: [mapping('user', 'user:status:warned', source.id)],
      warnedUsers: new Set(['alice']),
      bannedUsers: new Set(),
    });

    expect(plan.userTemplates[0]?.action).toBe('create');
    expect(plan.userTemplates[0]?.targetTemplateId).toBeNull();
    expect(plan.assignments[0]?.action).toBe('blocked_target_template');
  });

  test('refuses an ambiguous destination presentation match', () => {
    const source = template('source-question', 'Question');
    const plan = planFlairMigration({
      sourceUserTemplates: [],
      sourcePostTemplates: [source],
      sourceAssignments: [],
      targetUserTemplates: [],
      targetPostTemplates: [template('target-a', 'Question'), template('target-b', 'Question')],
      targetAssignments: [],
      mappings: [mapping('post', 'post:question', source.id)],
      warnedUsers: new Set(),
      bannedUsers: new Set(),
    });

    expect(plan.postTemplates[0]?.action).toBe('ambiguous');
    expect(plan.postTemplates[0]?.targetCandidates).toEqual(['target-a', 'target-b']);
  });

  test('surfaces unmapped source templates and recognises a target assignment without a template ID by unique visible semantics', () => {
    const mapped = template('source-catgirl', 'Catgirl', 'h');
    const unmapped = template('source-other', 'Other', 'x');
    const target = template('target-catgirl', 'Catgirl', 'h');
    const plan = planFlairMigration({
      sourceUserTemplates: [mapped, unmapped],
      sourcePostTemplates: [],
      sourceAssignments: [assignment('Alice', mapped.id, mapped.text, mapped.cssClass)],
      targetUserTemplates: [target],
      targetPostTemplates: [],
      targetAssignments: [assignment('alice', null, target.text, target.cssClass)],
      mappings: [mapping('user', 'user:community:catgirl', mapped.id)],
      warnedUsers: new Set(),
      bannedUsers: new Set(),
    });

    expect(plan.unmappedSourceUserTemplates).toEqual(['source-other']);
    expect(plan.assignments[0]?.action).toBe('already_correct');
  });

  test('reports local warned and banned state disagreements case-insensitively instead of hiding them in flair mapping', () => {
    const plan = planFlairMigration({
      sourceUserTemplates: [],
      sourcePostTemplates: [],
      sourceAssignments: [
        assignment('Alice', null, 'Ordinary', 'h'),
        assignment('Bob', null, 'Warned', 'w'),
        assignment('Carol', null, 'Uncivil', 'u'),
      ],
      targetUserTemplates: [],
      targetPostTemplates: [],
      targetAssignments: [],
      mappings: [],
      warnedUsers: new Set(['Alice']),
      bannedUsers: new Set(['BOB']),
    });

    expect(plan.moderationMismatches).toContainEqual({ username: 'alice', kind: 'warned', localState: true, visibleFlairState: false });
    expect(plan.moderationMismatches).toContainEqual({ username: 'bob', kind: 'warned', localState: false, visibleFlairState: true });
    expect(plan.moderationMismatches).toContainEqual({ username: 'bob', kind: 'banned', localState: true, visibleFlairState: false });
    expect(plan.moderationMismatches).toContainEqual({ username: 'carol', kind: 'banned', localState: false, visibleFlairState: true });
  });

  test('requires a one-to-one explicit logical mapping', () => {
    const source = template('source-id', 'Catgirl');
    expect(() => planFlairMigration({
      sourceUserTemplates: [source],
      sourcePostTemplates: [],
      sourceAssignments: [],
      targetUserTemplates: [],
      targetPostTemplates: [],
      targetAssignments: [],
      mappings: [
        mapping('user', 'logical:a', source.id),
        mapping('user', 'logical:b', source.id),
      ],
      warnedUsers: new Set(),
      bannedUsers: new Set(),
    })).toThrow('Duplicate source flair mapping');
  });
});
