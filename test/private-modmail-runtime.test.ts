import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ConversationModerationClassifier,
  ModerationClassification,
  ModerationItem,
} from '../src/mod/classifier.ts';
import type { PrivateResolutionClassifier } from '../src/mod/privateResolution.ts';
import { PrivateModmailRuntime, type PrivateModerationReputation } from '../src/mod/privateRuntime.ts';
import { ModmailAuditStore } from '../src/modmail/auditStore.ts';
import { ModmailStore } from '../src/modmail/store.ts';
import type { ModmailConversation, ModmailMessage } from '../src/modmail/types.ts';
import type { ReputationUser } from '../src/reputation/store.ts';
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

const moderator = {
  id: 'm1',
  name: 'AliceMod',
  isModerator: true,
  isAdmin: false,
  isParticipant: false,
  isHidden: false,
  isDeleted: false,
} as const;

const message = (
  id: string,
  bodyMarkdown: string,
  createdAt: number,
  author: typeof participant | typeof moderator = participant,
): ModmailMessage => ({
  id,
  conversationId: 'abc',
  author,
  bodyMarkdown,
  createdAt,
  isInternal: false,
  participatingAs: author.isModerator ? 'moderator' : 'participant_user',
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

const uncivilUser: ReputationUser = {
  username: 'SomeUser',
  points: -4,
  tier: 0,
  status: 'uncivil',
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

const fixture = async (): Promise<{ relay: ModmailStore; audit: ModmailAuditStore }> => {
  const root = await mkdtemp(join(tmpdir(), 'mae-private-modmail-'));
  roots.push(root);
  return {
    relay: new ModmailStore(join(root, 'modmail.pb')),
    audit: new ModmailAuditStore(join(root, 'audit.pb')),
  };
};

describe('private modmail moderation runtime', () => {
  test('audits only participant messages, persists the OpenAI conversation id, and clears a temporary mute on a genuine apology', async () => {
    const { relay, audit } = await fixture();
    const first = message('m1', 'initial message', 100);
    await relay.sync([conversation([first])], 100);
    const modReply = message('m2', 'Please explain what happened.', 150, moderator);
    const apology = message('m3', 'I was wrong. I should not have spoken like that.', 200);
    await relay.sync([conversation([first, modReply, apology])], 200);

    const classified: ModerationItem[] = [];
    const classifiers: Array<string | undefined> = [];
    const classifierFactory = (conversationId: string | undefined): ConversationModerationClassifier => {
      classifiers.push(conversationId);
      return {
        conversationId: conversationId ?? 'conv_modmail_abc',
        classify: async item => {
          classified.push(item);
          return clean;
        },
      };
    };

    const contributions = new Set<string>();
    let muteClears = 0;
    const reputation: PrivateModerationReputation = {
      user: async () => uncivilUser,
      hasContribution: async fullname => contributions.has(fullname),
      applyModeration: async input => {
        contributions.add(input.fullname);
        return uncivilUser;
      },
      clearMuteForConstructiveResolution: async () => {
        muteClears += 1;
        return true;
      },
      raw: async (): Promise<Json> => ({
        users: { someuser: { points: -4, status: 'uncivil' } },
        reputationJournal: {},
      }),
    };
    const resolution: PrivateResolutionClassifier = {
      classify: async () => ({ genuineApology: true, reason: 'sincere acknowledgement' }),
    };

    const runtime = new PrivateModmailRuntime(
      { key: 'test', model: 'test', effort: 'low' },
      relay,
      audit,
      reputation,
      classifierFactory,
      resolution,
    );
    const result = await runtime.tick();

    expect(result).toEqual({ inspected: 2, audited: 1, apologies: 1, skipped: 1, failed: 0 });
    expect(classified).toHaveLength(1);
    expect(classified[0]?.kind).toBe('modmail');
    expect(classified[0]?.text).toContain('Please explain what happened.');
    expect(classified[0]?.text).toContain('I was wrong. I should not have spoken like that.');
    expect(classifiers).toEqual([undefined]);
    expect(muteClears).toBe(1);
    expect(await audit.cursor()).toBe(2);
    expect((await audit.conversation('abc'))?.openaiConversationId).toBe('conv_modmail_abc');

    const second = await runtime.tick();
    expect(second).toEqual({ inspected: 0, audited: 0, apologies: 0, skipped: 0, failed: 0 });
    expect(classified).toHaveLength(1);
  });

  test('a failed participant audit does not advance past the failed event', async () => {
    const { relay, audit } = await fixture();
    const first = message('m1', 'initial message', 100);
    await relay.sync([conversation([first])], 100);
    const second = message('m2', 'new participant message', 200);
    await relay.sync([conversation([first, second])], 200);

    const reputation: PrivateModerationReputation = {
      user: async () => uncivilUser,
      hasContribution: async () => false,
      applyModeration: async () => uncivilUser,
      clearMuteForConstructiveResolution: async () => false,
      raw: async (): Promise<Json> => ({
        users: { someuser: { points: -4, status: 'uncivil' } },
        reputationJournal: {},
      }),
    };
    const runtime = new PrivateModmailRuntime(
      { key: 'test', model: 'test', effort: 'low' },
      relay,
      audit,
      reputation,
      () => ({
        conversationId: undefined,
        classify: async () => { throw new Error('classifier unavailable'); },
      }),
      { classify: async () => ({ genuineApology: false, reason: 'no' }) },
    );

    expect((await runtime.tick()).failed).toBe(1);
    expect(await audit.cursor()).toBe(0);
  });
});
