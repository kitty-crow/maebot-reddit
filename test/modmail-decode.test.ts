import { describe, expect, test } from 'bun:test';
import { modmailConversation, modmailConversations } from '../src/modmail/decode.ts';

describe('Reddit modmail decoder', () => {
  test('joins top-level messages through conversation objIds', () => {
    const page = modmailConversations({
      conversations: {
        abc: {
          id: 'abc',
          conversationType: 'sr_user',
          subject: 'Appeal',
          state: 1,
          lastUpdated: '2026-08-23T12:30:00Z',
          subreddit: { displayName: 'catgirlcoin' },
          participant: { id: 'u1', name: 'SomeUser', isParticipant: true },
          objIds: [
            { key: 'messages', id: 'm1' },
            { key: 'messages', id: 'm2' },
          ],
        },
      },
      messages: {
        m2: {
          id: 'm2',
          bodyMarkdown: 'Moderator reply',
          date: '2026-08-23T12:30:00Z',
          participatingAs: 'moderator',
          author: { id: 'mod1', name: 'Alice', isMod: true },
        },
        m1: {
          id: 'm1',
          bodyMarkdown: 'Please review this',
          date: '2026-08-23T12:29:00Z',
          participatingAs: 'participant_user',
          author: { id: 'u1', name: 'SomeUser', isParticipant: true },
        },
      },
      after: 'ModmailConversation_xyz',
    });

    expect(page.after).toBe('ModmailConversation_xyz');
    expect(page.conversations).toHaveLength(1);
    expect(page.conversations[0]?.kind).toBe('sr_user');
    expect(page.conversations[0]?.state).toBe('inprogress');
    expect(page.conversations[0]?.participant?.name).toBe('SomeUser');
    expect(page.conversations[0]?.messages.map(message => message.id)).toEqual(['m1', 'm2']);
    expect(page.conversations[0]?.messages[0]?.bodyMarkdown).toBe('Please review this');
  });

  test('decodes a full conversation response with nested messages', () => {
    const conversation = modmailConversation({
      conversation: {
        id: 'closed1',
        conversationType: 'sr_user',
        state: 'archived',
        subject: 'Closed case',
        subreddit: { displayName: 'catgirlcoin' },
        participant: { name: 'User', isParticipant: true },
        messages: {
          one: {
            id: 'one',
            bodyMarkdown: 'hello',
            date: '2026-08-23T12:00:00Z',
            author: { name: 'User', isParticipant: true },
            participatingAs: 'participant_user',
          },
        },
      },
    });

    expect(conversation.id).toBe('closed1');
    expect(conversation.state).toBe('archived');
    expect(conversation.messages[0]?.conversationId).toBe('closed1');
  });
});
