import { describe, expect, test } from 'bun:test';
import { authoritativeFlairRestores } from '../src/reputation/flairReconcile.ts';
import type { RedditFlairAssignment } from '../src/reddit/types.ts';

const reputation = {
  users: {
    alice: {
      username: 'Alice',
      status: 'ordinary',
      desiredFlairTemplateId: 'canonical-id',
      desiredFlairText: ':hana:',
      immutableModeratorFlair: false,
      needsFlair: false,
    },
  },
};

const assignment = (
  templateId: string | null,
  text: string | null,
): RedditFlairAssignment => ({
  username: 'Alice',
  templateId,
  text,
  cssClass: 'h',
});

describe('authoritative flair reconciliation with Reddit legacy assignments', () => {
  test('does not rewrite a correct visible flair when Reddit omits its template UUID', () => {
    expect(authoritativeFlairRestores(reputation, [assignment(null, ':hana:')])).toEqual([]);
  });

  test('restores a visibly wrong flair even when Reddit omits its template UUID', () => {
    expect(authoritativeFlairRestores(reputation, [assignment(null, ':kita:')])).toEqual([
      { username: 'Alice', templateId: 'canonical-id', text: ':hana:' },
    ]);
  });

  test('restores an explicitly wrong UUID even when visible text matches', () => {
    expect(authoritativeFlairRestores(reputation, [assignment('wrong-id', ':hana:')])).toEqual([
      { username: 'Alice', templateId: 'canonical-id', text: ':hana:' },
    ]);
  });
});
