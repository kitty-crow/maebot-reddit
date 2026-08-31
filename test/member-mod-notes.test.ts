import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memberModNoteText } from '../src/modnotes/assessor.ts';
import { parseMemberAuditLog } from '../src/modnotes/auditResults.ts';
import { memberInventoryFromReputation } from '../src/modnotes/inventory.ts';
import { MemberModNotesRedditClient } from '../src/modnotes/reddit.ts';
import { MemberModNoteStore } from '../src/modnotes/store.ts';
import type { RedditAuthCfg } from '../src/env.ts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const auth: RedditAuthCfg = {
  clientId: 'client',
  clientSecret: 'secret',
  username: 'mae',
  password: 'password',
  userAgent: 'test',
};

const token = (): Response => new Response(JSON.stringify({
  access_token: 'token',
  expires_in: 3600,
}), { status: 200 });

const listing = (): Response => new Response(JSON.stringify({
  kind: 'Listing',
  data: {
    after: null,
    children: [
      {
        kind: 't1',
        data: {
          id: 'a',
          name: 't1_a',
          subreddit: 'catgirlcoin',
          link_id: 't3_x',
          author: 'Member',
          body: 'Helpful answer',
          permalink: '/r/catgirlcoin/comments/x/post/a/',
          created_utc: 30,
          score: 4,
        },
      },
      {
        kind: 't1',
        data: {
          id: 'b',
          name: 't1_b',
          subreddit: 'elsewhere',
          link_id: 't3_y',
          author: 'Member',
          body: 'Outside sample',
          permalink: '/r/elsewhere/comments/y/post/b/',
          created_utc: 20,
          score: 1,
        },
      },
      {
        kind: 't1',
        data: {
          id: 'c',
          name: 't1_c',
          subreddit: 'nyaonearth',
          link_id: 't3_z',
          author: 'Member',
          body: 'Another useful comment',
          permalink: '/r/nyaonearth/comments/z/post/c/',
          created_utc: 10,
          score: 2,
        },
      },
    ],
  },
}), { status: 200 });

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
    await store.generated('Member', 'Mae score: 42. Constructive participant.', 'Constructive participant.', 'SOLID_CONTRIBUTOR', ['t1_a'], 123);
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

  test('samples only comments from the two moderated communities', async () => {
    const calls: string[] = [];
    const client = new MemberModNotesRedditClient(auth, {
      fetcher: async input => {
        const url = String(input);
        calls.push(url);
        return url.includes('/api/v1/access_token') ? token() : listing();
      },
    });
    const comments = await client.recentCommentsInCommunities('Member', ['catgirlcoin', 'nyaonearth'], 10);
    expect(comments.map(comment => comment.fullname)).toEqual(['t1_a', 't1_c']);
    expect(calls.some(url => url.includes('/user/Member/comments'))).toBe(true);
  });

  test('posts and deletes tracked native Mod Notes with Reddit label constants', async () => {
    let body = '';
    const calls: { readonly url: string; readonly method: string }[] = [];
    const client = new MemberModNotesRedditClient(auth, {
      fetcher: async (input, init) => {
        const url = String(input);
        if (url.includes('/api/v1/access_token')) return token();
        calls.push({ url, method: init?.method ?? 'GET' });
        body = init?.body instanceof URLSearchParams ? init.body.toString() : body;
        if (init?.method === 'DELETE') return new Response('{}', { status: 200 });
        return new Response(JSON.stringify({ id: 'ModNote_test' }), { status: 200 });
      },
    });
    const note = memberModNoteText(42, 'x'.repeat(500));
    expect(note.length).toBe(250);
    const id = await client.addModNote('catgirlcoin', 'Member', note, 'HELPFUL_USER', 't1_a');
    expect(id).toBe('ModNote_test');
    const form = new URLSearchParams(body);
    expect(form.get('subreddit')).toBe('catgirlcoin');
    expect(form.get('user')).toBe('Member');
    expect(form.get('label')).toBe('HELPFUL_USER');
    expect(form.get('note')).toBe(note);
    expect(form.get('reddit_id')).toBe('t1_a');

    await client.deleteModNote('catgirlcoin', 'Member', id);
    const deletion = calls.find(call => call.method === 'DELETE');
    expect(deletion?.url).toContain('note_id=ModNote_test');
    expect(deletion?.url).toContain('subreddit=catgirlcoin');
    expect(deletion?.url).toContain('user=Member');
  });
});
