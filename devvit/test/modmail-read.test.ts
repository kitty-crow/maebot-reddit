import { describe, expect, test } from 'vitest';
import { normaliseModmailState, parseModmailReadRequest,
  projectModmailConversation, projectModmailPage } from '../src/server/modmailRead.ts';

const conversation = {
  id: 'abc123',
  subreddit: { displayName: 'catgirlcoin' },
  subject: 'Hello',
  state: 'InProgress',
  lastUpdated: '2026-11-08T08:00:00Z',
  messages: {
    'msg123': { id: 'msg123', date: '2026-11-08T08:00:00Z', bodyMarkdown: 'Hi', isInternal: false },
  },
};

describe('read-only Devvit Modmail projections', () => {
  test('normalises the native Modmail state without misclassifying archived conversations', () => {
    expect(normaliseModmailState('InProgress')).toBe('inprogress');
    expect(normaliseModmailState('Archived')).toBe('archived');
    expect(normaliseModmailState('JoinRequests')).toBe('join_requests');
    expect(() => normaliseModmailState('SomethingUnexpected')).toThrow();
  });
  test('retains messages and original metadata without creating new state', () => {
    expect(projectModmailConversation(conversation, 'catgirlcoin')).toEqual({
      ...conversation, state: 'inprogress',
    });
  });
  test('refuses to read a conversation from another community', () => {
    expect(() => projectModmailConversation(conversation, 'nyaonearth')).toThrow();
    expect(() => projectModmailConversation({ ...conversation, id: undefined }, 'catgirlcoin')).toThrow();
  });
  test('derives a safe page cursor from Reddit ordered conversation ids', () => {
    expect(projectModmailPage({
      conversationIds: ['abc123'], conversations: { abc123: conversation },
    }, 'catgirlcoin', 1)).toEqual({
      protocol: 1,
      mode: 'list',
      subreddit: 'catgirlcoin',
      data: {
        conversations: { abc123: { ...conversation, state: 'inprogress' } },
        after: 'abc123',
      },
    });
    expect(projectModmailPage({
      conversationIds: ['abc123'], conversations: { abc123: conversation },
    }, 'catgirlcoin', 2).data.after).toBeNull();
  });
  test('rejects incomplete, duplicate and unscoped pages', () => {
    expect(() => projectModmailPage({
      conversationIds: ['abc123'], conversations: {},
    }, 'catgirlcoin', 25)).toThrow();
    expect(() => projectModmailPage({
      conversationIds: ['abc123', 'abc123'], conversations: { abc123: conversation },
    }, 'catgirlcoin', 25)).toThrow();
    expect(() => projectModmailPage({
      conversationIds: ['abc123'], conversations: { abc123: conversation },
    }, 'nyaonearth', 25)).toThrow();
  });
  test('rejects mark-read side effects and arbitrary communities', () => {
    expect(parseModmailReadRequest({
      subreddit: 'catgirlcoin', mode: 'detail', conversationId: 'abc123',
    })).toEqual({ subreddit: 'catgirlcoin', mode: 'detail', conversationId: 'abc123' });
    expect(() => parseModmailReadRequest({
      subreddit: 'catgirlcoin', mode: 'detail', conversationId: 'abc123', markRead: true,
    })).toThrow();
    expect(() => parseModmailReadRequest({
      subreddit: 'unrelated', mode: 'list', limit: 10,
    })).toThrow();
    expect(parseModmailReadRequest({
      subreddit: 'nyaonearth', mode: 'list', limit: 100, after: null,
    })).toEqual({ subreddit: 'nyaonearth', mode: 'list', limit: 100, after: null });
  });
});
