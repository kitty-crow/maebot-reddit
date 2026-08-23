import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModerationClassification, ModerationItem } from '../src/mod/classifier.ts';
import { PrivateModmailRuntime, type PrivateModerationReputation } from '../src/mod/privateRuntime.ts';
import { ModmailAuditStore } from '../src/modmail/auditStore.ts';
import { ModmailStore } from '../src/modmail/store.ts';
import type { ModmailConversation, ModmailMessage } from '../src/modmail/types.ts';
import type { Json } from '../src/types/json.ts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const participant = {
  id: 'u1',
  name: 'SomeUser',
  isModerator: false,
  isAdmin: false,
  isParticipant: true,
  isHidden: false,
  isDeleted: false,
} as const;

const message = (id: string, bodyMarkdown: string, createdAt: number): ModmailMessage => ({
  id,
  conversationId: 'abc',
  author: participant,
  bodyMarkdown,
  createdAt,
  isInternal: false,
  participatingAs: 'participant_user',
});

const conversation = (messages: readonly ModmailMessage[]): ModmailConversation => ({
  id: 'abc',
  subreddit: 'catgirlcoin',
  subject: 'Appeal',
  participant,
  kind: 'sr_user',
  state: 'inprogress',
  isInternal: false,
  isAuto: false,
  lastUpdatedAt: messages.at(-1)?.createdAt ?? 0,
  messages,
});

const clean: ModerationClassification = {
  verdict: 'clean',
  rule: 'none',
  disposition: 'allow',
  penaltyPoints: 0,
  confidence: 1,
  reason: 'clean',
  evidence: [],
};

const reputation = (): PrivateModerationReputation => {
  const contributions = new Set<string>();
  return {
    user: async () => null,
    hasContribution: async fullname => contributions.has(fullname),
    applyModeration: async input => {
      contributions.add(input.fullname);
      return {
        username: input.author,
        points: 0,
        tier: 0,
        status: 'warned',
        currentFlairTemplateId: null,
        currentFlairText: null,
        currentFlairCssClass: null,
        desiredFlairTemplateId: null,
        desiredFlairText: null,
        immutableModeratorFlair: false,
        needsFlair: false,
        needsReview: false,
        source: 'live-contribution',
        seededAt: 1,
      };
    },
    clearMuteForConstructiveResolution: async () => false,
    raw: async (): Promise<Json> => ({ users: {}, reputationJournal: {} }),
  };
};

test('fresh startup imports historic Modmail after private bootstrap without retroactive audit and keeps it as context', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mae-private-modmail-fresh-'));
  roots.push(root);
  const relay = new ModmailStore(join(root, 'modmail.pb'));
  const audit = new ModmailAuditStore(join(root, 'audit.pb'));
  const classified: ModerationItem[] = [];
  const runtime = new PrivateModmailRuntime(
    { key: 'test', model: 'test', effort: 'low' },
    relay,
    audit,
    reputation(),
    () => ({
      conversationId: 'conv_modmail_abc',
      classify: async item => {
        classified.push(item);
        return clean;
      },
    }),
    { classify: async () => ({ genuineApology: false, reason: 'no' }) },
  );

  // This is the real fresh-process order: the private audit boundary is
  // established before the transport has populated its canonical store.
  expect(await runtime.bootstrap()).toBe(0);
  expect(await audit.cursor()).toBe(0);

  const historic = message('m1', 'Historic participant context.', 100);
  expect(await relay.sync([conversation([historic])], 100)).toEqual([]);
  expect(classified).toHaveLength(0);
  expect(await runtime.tick()).toEqual({ inspected: 0, audited: 0, apologies: 0, skipped: 0, failed: 0 });

  const live = message('m2', 'This is the first live participant message.', 200);
  const events = await relay.sync([conversation([historic, live])], 200);
  expect(events.map(event => event.messageId)).toEqual(['m2']);

  expect(await runtime.tick()).toEqual({ inspected: 1, audited: 1, apologies: 0, skipped: 0, failed: 0 });
  expect(classified).toHaveLength(1);
  expect(classified[0]?.text).toContain('Historic participant context.');
  expect(classified[0]?.text).toContain('This is the first live participant message.');
  expect(await audit.cursor()).toBe(1);
});
