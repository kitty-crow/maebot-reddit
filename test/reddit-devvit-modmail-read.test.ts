import { describe, expect, test } from 'bun:test';
import { DevvitExternalClient, type DevvitExternalFetch } from '../src/reddit/devvitExternal.ts';
import { parseDevvitModmailPage, parseDevvitModmailDetail } from '../src/reddit/devvitModmailRead.ts';
import { modmailConversations, modmailConversation } from '../src/modmail/decode.ts';

const subreddit = 'catgirlcoin';
const row = {
  id: 'abc123',
  subreddit: { displayName: subreddit },
  state: 'inprogress',
  subject: 'Example',
  lastUpdated: '2026-11-08T08:00:00Z',
  isInternal: false,
  participant: { id: 't2_abc', name: 'Alice', isMod: false, isParticipant: true },
  messages: { msg123: {
    id: 'msg123', date: '2026-11-08T08:00:00Z',
    bodyMarkdown: 'Hello', isInternal: false,
    author: { name: 'Alice', id: 't2_abc', isParticipant: true },
  } },
};
const sourcePage = { conversations: { abc123: row }, after: 'abc123' };
const envelope = (mode: 'list' | 'detail', data: object, community: string = subreddit): string =>
  JSON.stringify({ protocol: 1, mode, subreddit: community, data });

describe('Devvit Modmail read-only parity', () => {
  test('uses the existing canonical Modmail conversation decoder', () => {
    const wire = envelope('list', sourcePage);
    const parsed = parseDevvitModmailPage(wire, { subreddit, limit: 25, after: null });
    expect(parsed).toEqual(modmailConversations(JSON.parse(JSON.stringify(sourcePage))));
    expect(parsed.conversations[0]?.messages[0]?.bodyMarkdown).toBe('Hello');
    expect(parsed.conversations[0]?.state).toBe('inprogress');
  });
  test('preserves conversation details without silently marking them read', () => {
    const data = { conversation: row };
    expect(parseDevvitModmailDetail(envelope('detail', data), subreddit, 'abc123')).toEqual(
      modmailConversation(JSON.parse(JSON.stringify(data))),
    );
  });
  test('rejects another subreddit or an incorrect conversation id', () => {
    expect(() => parseDevvitModmailPage(
      envelope('list', sourcePage, 'nyaonearth'),
      { subreddit, limit: 25, after: null },
    )).toThrow();
    expect(() => parseDevvitModmailDetail(envelope('detail', { conversation: row }), subreddit, 'other')).toThrow();
  });
  test('rejects repeated page cursors and any cross-community conversation', () => {
    expect(() => parseDevvitModmailPage(envelope('list', sourcePage),
      { subreddit, limit: 25, after: 'abc123' })).toThrow();
    const altered = { conversations: { abc123: { ...row, subreddit: { displayName: 'nyaonearth' } } }, after: null };
    expect(() => parseDevvitModmailPage(envelope('list', altered),
      { subreddit, limit: 25, after: null })).toThrow();
  });
  test('requests only read-only Modmail previews using managed authentication', async () => {
    const modes: string[] = [];
    const fetcher: DevvitExternalFetch = async (url, init) => {
      expect(url).toBe('https://this-is-the-mae-abc123-external.devvit.net/external/mae/read/modmail');
      expect(new Headers(init.headers).get('authorization')).toBe('bearer devvit_at_test_secret_key');
      const req = JSON.parse(String(init.body)) as { readonly mode: 'list' | 'detail'; readonly conversationId?: string };
      modes.push(req.mode);
      return new Response(req.mode === 'list'
        ? envelope('list', sourcePage)
        : envelope('detail', { conversation: row }));
    };
    const client = new DevvitExternalClient({
      baseUrl: 'https://this-is-the-mae-abc123-external.devvit.net',
      managedToken: 'devvit_at_test_secret_key',
    }, fetcher);
    expect((await client.previewModmailConversations(subreddit, 25)).conversations).toHaveLength(1);
    expect((await client.previewModmailConversation(subreddit, 'abc123')).id).toBe('abc123');
    expect(modes).toEqual(['list', 'detail']);
  });
});
