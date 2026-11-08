import { describe, expect, test } from 'bun:test';
import { DevvitExternalClient, type DevvitExternalFetch } from '../src/reddit/devvitExternal.ts';
import { parseDevvitLocalRules, parseDevvitModerators } from '../src/reddit/devvitCommunityRead.ts';

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
