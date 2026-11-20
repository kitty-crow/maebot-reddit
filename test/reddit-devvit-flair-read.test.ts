import { describe, expect, test } from 'bun:test';
import { DevvitExternalClient, type DevvitExternalFetch } from '../src/reddit/devvitExternal.ts';
import { parseDevvitFlairAssignment, parseDevvitFlairAssignments,
  parseDevvitFlairTemplates } from '../src/reddit/devvitFlairRead.ts';

const subreddit = 'catgirlcoin';
const wrap = (kind: string, value: object, community: string = subreddit): string =>
  JSON.stringify({ protocol: 1, subreddit: community, kind, ...value });
const template = {
  id: '12345678-9012', text: 'Trusted', cssClass: null, textColour: 'dark',
  backgroundColour: '#ffffff', modOnly: true, textEditable: false,
  allowableContent: 'text', maxEmojis: 1,
};
const assignment = { username: 'Alice', templateId: null, text: 'Trusted', cssClass: 'trusted' };

describe('Devvit flair read previews', () => {
  test('maps native flair templates to the original RedditFlairTemplate shape', () => {
    expect(parseDevvitFlairTemplates(wrap('user-templates', { templates: [template] }),
      subreddit, 'user-templates')).toEqual([template]);
  });
  test('rejects duplicate templates and inconsistent subreddits', () => {
    expect(() => parseDevvitFlairTemplates(wrap('post-templates', { templates: [template,template] }),
      subreddit, 'post-templates')).toThrow();
    expect(() => parseDevvitFlairTemplates(wrap('post-templates', { templates: [template] }, 'nyaonearth'),
      subreddit, 'post-templates')).toThrow();
  });
  test('does not fabricate template UUIDs in user flair inventories', () => {
    expect(parseDevvitFlairAssignments(wrap('user-assignments', {
      assignments: [assignment],
    }), subreddit)).toEqual([assignment]);
    expect(parseDevvitFlairAssignment(wrap('user-assignment', {
      assignment,
    }), subreddit, 'alice')).toEqual(assignment);
  });
  test('rejects duplicate and mismatched user-flair assignment names', () => {
    expect(() => parseDevvitFlairAssignments(wrap('user-assignments', {
      assignments: [assignment, { ...assignment, username: 'alice' }],
    }), subreddit)).toThrow();
    expect(() => parseDevvitFlairAssignment(wrap('user-assignment', {
      assignment,
    }), subreddit, 'bob')).toThrow();
  });
  test('authenticates the complete flair read group through one managed endpoint', async () => {
    const calls: string[] = [];
    const fetcher: DevvitExternalFetch = async (url, init) => {
      expect(url).toBe('https://this-is-the-mae-abc123-external.devvit.net/external/mae/read/flair');
      expect(new Headers(init.headers).get('authorization')).toBe('bearer devvit_at_test_secret_key');
      const request = JSON.parse(String(init.body)) as { readonly kind: string; readonly username?: string };
      calls.push(request.kind);
      return new Response(request.kind.endsWith('templates')
        ? wrap(request.kind, { templates: [template] })
        : request.kind === 'user-assignments'
          ? wrap(request.kind, { assignments: [assignment] })
          : wrap(request.kind, { assignment }));
    };
    const client = new DevvitExternalClient({
      baseUrl: 'https://this-is-the-mae-abc123-external.devvit.net',
      managedToken: 'devvit_at_test_secret_key',
    }, fetcher);
    expect(await client.readFlairTemplates(subreddit, 'user')).toEqual([template]);
    expect(await client.readFlairAssignments(subreddit)).toEqual([assignment]);
    expect(await client.readFlairAssignment(subreddit, 'Alice')).toEqual(assignment);
    expect(calls).toEqual(['user-templates', 'user-assignments', 'user-assignment']);
  });
});
