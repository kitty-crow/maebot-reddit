import { describe, expect, test } from 'bun:test';
import { DevvitExternalClient, type DevvitExternalFetch } from '../src/reddit/devvitExternal.ts';
import { parseDevvitLocalRules, parseDevvitModerators, parseDevvitRelationships } from '../src/reddit/devvitCommunityRead.ts';
import { relationshipUsers } from '../src/reddit/decode.ts';

const community = 'catgirlcoin';
const envelope = (kind: string, data: object): string =>
  JSON.stringify({ protocol: 1, subreddit: community, kind, ...data });

describe('Devvit community-read parity boundary', () => {
  test('preserves moderator identity and community-specific permissions', () => {
    const content = envelope('moderators', {
      moderators: [{ name: 'Mae', id: 't2_abc', permissions: ['posts', 'flair'] }],
    });
    expect(parseDevvitModerators(content, community)).toEqual([
      { name: 'Mae', id: 't2_abc', permissions: ['posts', 'flair'] },
    ]);
  });
  test('rejects duplicates and installation identity mismatches', () => {
    const content = envelope('moderators', { moderators: [
      { name: 'Mae', id: 't2_abc', permissions: ['all'] },
      { name: 'mae', id: 't2_abc', permissions: ['posts'] },
    ] });
    expect(() => parseDevvitModerators(content, community)).toThrow();
    expect(() => parseDevvitModerators(content, 'nyaonearth')).toThrow();
  });
  test('retains local rules but does not fabricate site rules', () => {
    const content = envelope('local-rules', { rules: [
      { shortName: 'No spam', description: 'No advertising',
        violationReason: 'Spam', kind: 'all', priority: 0 },
    ] });
    expect(parseDevvitLocalRules(content, community)).toEqual([
      { shortName: 'No spam', description: 'No advertising',
        violationReason: 'Spam', kind: 'all', priority: 0 },
    ]);
  });
  test('rejects incomplete rules and unsupported rule kinds', () => {
    expect(() => parseDevvitLocalRules(envelope('local-rules', {
      rules: [{ shortName: 'No spam', description: 'No advertising',
        violationReason: 'Spam', kind: 'other', priority: 0 }],
    }), community)).toThrow();
  });
  test('preserves the existing OAuth relationship decoder behaviour', () => {
    const users = [{ username: 'Alice', note: 'Repeat scam', date: 1794121200 }];
    const legacy = { data: { after: null, children: [
      { kind: 't2', data: { name: 'Alice', note: 'Repeat scam', date: 1794121200 } },
    ] } };
    expect(parseDevvitRelationships(envelope('banned', { users }), community, 'banned')).toEqual(
      relationshipUsers(JSON.parse(JSON.stringify(legacy)), 'banned users').items,
    );
    expect(parseDevvitRelationships(envelope('muted', { users: [
      { username: 'Alice', note: null, date: 1794121200 },
    ] }), community, 'muted')).toEqual([{ username: 'Alice', note: null, date: 1794121200 }]);
  });
  test('rejects duplicate users, wrong communities and invalid timestamps', () => {
    const alice = { username: 'Alice', note: null, date: 1794121200 };
    expect(() => parseDevvitRelationships(envelope('banned', {
      users: [alice, { ...alice, username: 'alice' }],
    }), community, 'banned')).toThrow();
    expect(() => parseDevvitRelationships(envelope('banned', { users: [alice] }), 'nyaonearth', 'banned')).toThrow();
    expect(() => parseDevvitRelationships(envelope('banned', {
      users: [{ ...alice, date: 'yesterday' }],
    }), community, 'banned')).toThrow();
  });
  test('requests banned and muted inventories through the managed transport', async () => {
    const calls: string[] = [];
    const fetcher: DevvitExternalFetch = async (url, init) => {
      expect(url).toBe('https://this-is-the-mae-abc123-external.devvit.net/external/mae/read/community');
      expect(new Headers(init.headers).get('authorization')).toBe('bearer devvit_at_test_secret_key');
      const request = JSON.parse(String(init.body)) as { readonly subreddit: string; readonly kind: string };
      calls.push(request.kind);
      return new Response(envelope(request.kind, { users: [] }));
    };
    const client = new DevvitExternalClient({
      baseUrl: 'https://this-is-the-mae-abc123-external.devvit.net',
      managedToken: 'devvit_at_test_secret_key',
    }, fetcher);
    expect(await client.readBannedUsers(community)).toEqual([]);
    expect(await client.readMutedUsers(community)).toEqual([]);
    expect(calls).toEqual(['banned', 'muted']);
  });
  test('sends a scoped read request, authenticates and validates its response', async () => {
    const fetcher: DevvitExternalFetch = async (url, init) => {
      expect(url).toBe('https://this-is-the-mae-abc123-external.devvit.net/external/mae/read/community');
      expect(new Headers(init.headers).get('authorization')).toBe('bearer devvit_at_test_secret_key');
      expect(JSON.parse(String(init.body))).toEqual({ subreddit: community, kind: 'moderators' });
      return new Response(envelope('moderators', { moderators: [] }));
    };
    const client = new DevvitExternalClient({
      baseUrl: 'https://this-is-the-mae-abc123-external.devvit.net',
      managedToken: 'devvit_at_test_secret_key',
    }, fetcher);
    expect(await client.readModerators(community)).toEqual([]);
  });
});
