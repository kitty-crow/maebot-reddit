import { describe, expect, test } from 'vitest';
import { parseFlairRequest, projectFlairTemplate, projectFlairAssignment,
  readFlairAssignments } from '../src/server/flairRead.ts';

const template = {
  id: 'f1929876-7777', text: 'Trusted', textColor: 'dark' as const,
  backgroundColor: '#ffffff', modOnly: true, allowUserEdits: false,
  allowableContent: 'text' as const, maxEmojis: 1,
};

describe('read-only flair inventory parity', () => {
  test('preserves all SDK template properties while identifying unavailable CSS class', () => {
    expect(projectFlairTemplate(template)).toEqual({
      id: template.id, text: 'Trusted', cssClass: null, textColour: 'dark',
      backgroundColour: '#ffffff', modOnly: true, textEditable: false,
      allowableContent: 'text', maxEmojis: 1,
    });
  });
  test('preserves visible user flair without fabricating a template UUID', () => {
    expect(projectFlairAssignment({ user: 'Alice', flairText: 'Trusted', flairCssClass: 'regular' }))
      .toEqual({ username: 'Alice', templateId: null, text: 'Trusted', cssClass: 'regular' });
    expect(projectFlairAssignment({ user: 'Bob' }))
      .toEqual({ username: 'Bob', templateId: null, text: null, cssClass: null });
  });
  test('limits the scope to Mae communities and explicit flair reads', () => {
    expect(parseFlairRequest({ subreddit: 'catgirlcoin', kind: 'user-templates' })).toEqual({
      subreddit: 'catgirlcoin', kind: 'user-templates', username: null,
    });
    expect(parseFlairRequest({ subreddit: 'nyaonearth', kind: 'user-assignment', username: 'Alice' }))
      .toEqual({ subreddit: 'nyaonearth', kind: 'user-assignment', username: 'Alice' });
    expect(() => parseFlairRequest({ subreddit: 'other', kind: 'post-templates' })).toThrow();
    expect(() => parseFlairRequest({ subreddit: 'catgirlcoin', kind: 'user-assignments', username: 'Bob' })).toThrow();
    expect(() => parseFlairRequest({ subreddit: 'catgirlcoin', kind: 'delete-flair' })).toThrow();
  });
  test('reads every user flair page without silent truncation', async () => {
    const requests: string[] = [];
    const users = await readFlairAssignments({ getUserFlair: async options => {
      requests.push(options.after ?? 'first');
      return options.after === undefined
        ? { users: [{ user: 'Alice', flairText: 'Trusted' }], next: 't2_abc' }
        : { users: [{ user: 'Bob', flairText: 'Member' }] };
    } });
    expect(users.map(item => item.username)).toEqual(['Alice', 'Bob']);
    expect(requests).toEqual(['first', 't2_abc']);
  });
  test('rejects repeated cursors, duplicate users and missing username', async () => {
    await expect(readFlairAssignments({ getUserFlair: async options => ({
      users: [{ user: options.after === undefined ? 'Alice' : 'Bob' }], next: 't2_abc',
    }) })).rejects.toThrow('cursor stalled');
    await expect(readFlairAssignments({ getUserFlair: async options => ({
      users: [{ user: 'Alice' }], ...(options.after === undefined ? { next: 't2_abc' } : {}),
    }) })).rejects.toThrow('Duplicate');
    expect(() => projectFlairAssignment({ flairText: 'Anonymous' })).toThrow();
  });
});
