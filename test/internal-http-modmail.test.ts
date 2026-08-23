import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RedditInternalHttpServer } from '../src/http/server.ts';
import { ModerationReviewStore } from '../src/mod/review.ts';
import { ModmailReplyOutbox } from '../src/modmail/outbox.ts';
import { ModmailStore } from '../src/modmail/store.ts';
import type { ModmailConversation } from '../src/modmail/types.ts';
import { QuestionEventStore } from '../src/questions/events.ts';
import type { ReputationUser } from '../src/reputation/store.ts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const conversation = (): ModmailConversation => ({
  id: 'abc123',
  subreddit: 'catgirlcoin',
  subject: 'Need help',
  participant: {
    id: 'u1',
    name: 'SomeUser',
    isModerator: false,
    isAdmin: false,
    isParticipant: true,
    isHidden: false,
    isDeleted: false,
  },
  kind: 'sr_user',
  state: 'inprogress',
  isInternal: false,
  isAuto: false,
  lastUpdatedAt: 100,
  messages: [{
    id: 'm1',
    conversationId: 'abc123',
    author: {
      id: 'u1',
      name: 'SomeUser',
      isModerator: false,
      isAdmin: false,
      isParticipant: true,
      isHidden: false,
      isDeleted: false,
    },
    bodyMarkdown: 'Hello moderators',
    createdAt: 100,
    isInternal: false,
    participatingAs: 'participant_user',
  }],
});

const canonicalUser: ReputationUser = {
  username: 'SomeUser',
  points: -4,
  tier: 0,
  status: 'uncivil',
  currentFlairTemplateId: 'uncivil-id',
  currentFlairText: ' ',
  currentFlairCssClass: 'u',
  desiredFlairTemplateId: 'uncivil-id',
  desiredFlairText: ' ',
  immutableModeratorFlair: false,
  needsFlair: false,
  needsReview: false,
  source: 'status-flair',
  seededAt: 1,
};

const fixture = async (withReputation: boolean) => {
  const root = await mkdtemp(join(tmpdir(), 'mae-internal-modmail-'));
  roots.push(root);
  const modmail = new ModmailStore(join(root, 'modmail.pb'));
  await modmail.sync([conversation()], 100);
  const server = new RedditInternalHttpServer(
    { host: '127.0.0.1', port: 0, token: 'secret' },
    new QuestionEventStore(join(root, 'questions.pb')),
    new ModerationReviewStore(join(root, 'reviews.pb')),
    () => undefined,
  );
  server.useModmail(
    modmail,
    new ModmailReplyOutbox(join(root, 'replies.pb')),
    null,
    withReputation ? { user: async () => canonicalUser } : null,
  );
  server.start();
  return { server, base: server.address() };
};

describe('Reddit internal Modmail API', () => {
  test('returns the canonical participant reputation with the canonical Reddit conversation', async () => {
    const { server, base } = await fixture(true);
    try {
      const response = await fetch(`${base}/v1/modmail/conversations/abc123`, {
        headers: { authorization: 'Bearer secret' },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as {
        conversation: { id: string; participant: { name: string } | null };
        reputation: ReputationUser | null;
      };
      expect(body.conversation.id).toBe('abc123');
      expect(body.conversation.participant?.name).toBe('SomeUser');
      expect(body.reputation).toMatchObject({
        username: 'SomeUser',
        points: -4,
        status: 'uncivil',
      });
    } finally {
      server.stop();
    }
  });

  test('returns null reputation when reputation service is deliberately unavailable', async () => {
    const { server, base } = await fixture(false);
    try {
      const response = await fetch(`${base}/v1/modmail/conversations/abc123`, {
        headers: { authorization: 'Bearer secret' },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { reputation: ReputationUser | null };
      expect(body.reputation).toBeNull();
    } finally {
      server.stop();
    }
  });

  test('keeps Modmail conversation data behind bearer authentication', async () => {
    const { server, base } = await fixture(true);
    try {
      const response = await fetch(`${base}/v1/modmail/conversations/abc123`);
      expect(response.status).toBe(401);
    } finally {
      server.stop();
    }
  });
});