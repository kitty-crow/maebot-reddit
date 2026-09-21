import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memberModNoteText } from '../src/modnotes/assessor.ts';
import { parseMemberAuditLog } from '../src/modnotes/auditResults.ts';
import { memberInventoryFromReputation } from '../src/modnotes/inventory.ts';
import { MemberModNoteStore } from '../src/modnotes/store.ts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('member Mod Notes experiment', () => {
  test('reads the canonical member inventory from reputation protobuf data and marks moderators', () => {
    const rows = memberInventoryFromReputation({
      schema: 1,
      users: {
        member: {
          username: 'Member',
          points: 42,
          status: 'ordinary',
          immutableModeratorFlair: false,
        },
        mod: {
          username: 'Mod',
          points: 999999999,
          status: 'moderator',
          immutableModeratorFlair: true,
        },
      },
    });
    expect(rows).toEqual([
      { username: 'Member', points: 42, status: 'ordinary', moderator: false },
      { username: 'Mod', points: 999999999, status: 'moderator', moderator: true },
    ]);
  });

  test('parses completed audit USER RESULT blocks without reclassifying content', () => {
    const parsed = parseMemberAuditLog(`Members: 1
------------------------------------------------------------------------------------------
USER RESULT 1/1: u/Member
Notes: Constructive participant.
Score: -1 -> 4
Status: warned -> ordinary
Tag: Good Contributor (SOLID_CONTRIBUTOR)
Mod Note: Mae score: 4. Constructive participant.
Confidence: 0.970
------------------------------------------------------------------------------------------
`);
    expect(parsed.declaredMembers).toBe(1);
    expect(parsed.duplicateUsers).toEqual([]);
    expect(parsed.results).toEqual([{
      username: 'Member',
      beforePoints: -1,
      afterPoints: 4,
      beforeStatus: 'warned',
      afterStatus: 'ordinary',
      summary: 'Constructive participant.',
      label: 'SOLID_CONTRIBUTOR',
      note: 'Mae score: 4. Constructive participant.',
    }]);
  });

  test('persists generated notes without copying score or flair fields into the note store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mae-member-notes-'));
    roots.push(root);
    const store = new MemberModNoteStore(join(root, 'notes.pb'));
    await store.seed(['Member']);
    await store.generated(
      'Member',
      'Mae score: 42. Constructive participant.',
      'Constructive participant.',
      'SOLID_CONTRIBUTOR',
      ['t1_a'],
      123,
    );
    await store.markApplied('Member', 'catgirlcoin');
    await store.markNativeNote('Member', 'catgirlcoin', 'ModNote_abc');
    expect(await store.record('member')).toEqual({
      username: 'Member',
      note: 'Mae score: 42. Constructive participant.',
      summary: 'Constructive participant.',
      label: 'SOLID_CONTRIBUTOR',
      sampledCommentFullnames: ['t1_a'],
      generatedAt: 123,
      appliedTo: ['catgirlcoin'],
      nativeNotes: [{ subreddit: 'catgirlcoin', noteId: 'ModNote_abc' }],
      error: null,
    });
  });

  test('keeps native Mod Note text inside Reddit limit', () => {
    expect(memberModNoteText(42, 'x'.repeat(500))).toHaveLength(250);
  });
});
