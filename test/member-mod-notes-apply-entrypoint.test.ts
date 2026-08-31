import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('completed member Mod Notes native apply entrypoint', () => {
  test('is native-note-only and does not touch reputation or re-audit', async () => {
    const source = await readFile(resolve(process.cwd(), 'scripts/applyMemberModNotes.ts'), 'utf8');

    expect(source).toContain('MEMBER_MOD_NOTES_NATIVE_APPLY');
    expect(source).toContain('reddit.addModNote');
    expect(source).toContain('reddit.deleteModNote');
    expect(source).toContain("['catgirlcoin', 'nyaonearth']");
    expect(source).not.toContain('reconcileReputationAudit');
    expect(source).not.toContain('redditModerationConfig');
    expect(source).not.toContain('ReputationStore');
    expect(source).not.toContain('recentCommentsInCommunities');
  });
});
