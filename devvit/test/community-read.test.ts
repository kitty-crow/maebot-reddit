import { describe, expect, test } from 'vitest';
import { parseCommunityRequest, projectModerator, projectRule, projectBannedUser, projectMutedUser, selectRelationship } from '../src/server/communityRead.ts';

describe('read-only community metadata', () => {
  test('keeps the original moderator permissions without inferring authority', () => {
    expect(projectModerator({
      username: 'Mae', id: 't2_abc', moderatorInfo: { modPermissions: ['posts', 'flair'] },
    })).toEqual({ name: 'Mae', id: 't2_abc', permissions: ['posts', 'flair'] });
  });
  test('preserves nullable-free native community rules without inventing site rules', () => {
    expect(projectRule({
      shortName: 'Stay civil', description: 'Be nice', violationReason: 'Uncivil',
      kind: 'all', priority: 1,
    })).toEqual({
      shortName: 'Stay civil', description: 'Be nice', violationReason: 'Uncivil',
      kind: 'all', priority: 1,
    });
  });
  test('preserves ban notes and seconds-since-epoch timestamps', () => {
    const date = new Date('2026-11-08T07:00:00.000Z');
    expect(projectBannedUser({ username: 'Alice', date, note: 'Repeat scam' })).toEqual({
      username: 'Alice', note: 'Repeat scam', date: 1794121200,
    });
    expect(projectBannedUser({ username: 'Bob', date })).toEqual({
      username: 'Bob', note: null, date: 1794121200,
    });
  });
  test('does not invent mute notes and rejects invalid timestamps', () => {
    expect(projectMutedUser({ username: 'Alice', date: new Date(0) })).toEqual({
      username: 'Alice', note: null, date: 0,
    });
    expect(() => projectMutedUser({ username: 'Alice', date: new Date('invalid') })).toThrow();
  });
  test('targeted relationship reads identify the correct person without scanning the whole inventory', () => {
    expect(parseCommunityRequest({
      subreddit: 'catgirlcoin', kind: 'banned-user', username: 'Alice',
    })).toEqual({ subreddit: 'catgirlcoin', kind: 'banned-user', username: 'Alice' });
    expect(parseCommunityRequest({
      subreddit: 'nyaonearth', kind: 'muted-user', username: 'Bob',
    })).toEqual({ subreddit: 'nyaonearth', kind: 'muted-user', username: 'Bob' });
    expect(() => parseCommunityRequest({
      subreddit: 'catgirlcoin', kind: 'banned-user',
    })).toThrow();
    expect(() => parseCommunityRequest({
      subreddit: 'catgirlcoin', kind: 'muted', username: 'Bob',
    })).toThrow();
    const alice = { username: 'Alice', date: 123 };
    expect(selectRelationship([alice], 'alice')).toEqual(alice);
    expect(selectRelationship([alice], 'bob')).toBeNull();
    expect(() => selectRelationship([alice, alice], 'Alice')).toThrow();
  });
  test('limits metadata requests to Mae communities and explicit operations', () => {
    expect(parseCommunityRequest({ subreddit: 'catgirlcoin', kind: 'moderators' }))
      .toEqual({ subreddit: 'catgirlcoin', kind: 'moderators' });
    expect(() => parseCommunityRequest({ subreddit: 'other', kind: 'moderators' })).toThrow();
    expect(parseCommunityRequest({ subreddit: 'nyaonearth', kind: 'banned' })).toEqual({ subreddit: 'nyaonearth', kind: 'banned' });
    expect(parseCommunityRequest({ subreddit: 'nyaonearth', kind: 'muted' })).toEqual({ subreddit: 'nyaonearth', kind: 'muted' });
    expect(() => parseCommunityRequest({ subreddit: 'nyaonearth', kind: 'mutate' })).toThrow();
  });
});
