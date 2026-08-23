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

const moderatorUser: ReputationUser = {
  ...uncivilUser,
  points: 999_999_999,
  tier: 9,
  status: 'moderator',
  immutableModeratorFlair: true,
  source: 'moderator',
};

const fixture = async (): Promise<{ relay: ModmailStore; audit: ModmailAuditStore }> => {
  const root = await mkdtemp(join(tmpdir(), 'mae-private-modmail-'));
  roots.push(root);
  return {
    relay: new ModmailStore(join(root, 'modmail.pb')),
    audit: new ModmailAuditStore(join(root, 'audit.pb')),
  };
};

const fakeReputation = (onClear: () => void = () => undefined): PrivateModerationReputation => {
  const contributions = new Set<string>();
  return {
    user: async () => uncivilUser,
    hasContribution: async fullname => contributions.has(fullname),
    applyModeration: async input => {
      contributions.add(input.fullname);
      return uncivilUser;
    },
    clearMuteForConstructiveResolution: async () => {
      onClear();
      return true;
    },
    raw: async (): Promise<Json> => ({
      users: { someuser: { points: -4, status: 'uncivil' } },
      reputationJournal: {},
    }),
  };
};

describe('private modmail moderation runtime', () => {
  test('existing relay history becomes context but is not retroactively moderated when private auditing is first enabled', async () => {
    const { relay, audit } = await fixture();
    const first = message('m1', 'historic participant message', 100);
    await relay.sync([conversation([first])], 100);
    const second = message('m2', 'historic follow-up', 150);
    await relay.sync([conversation([first, second])], 150);

    let classifications = 0;
    const runtime = new PrivateModmailRuntime(
      { key: 'test', model: 'test', effort: 'low' },
      relay,
      audit,
      fakeReputation(),
      () => ({
        conversationId: 'should-not-be-created',
        classify: async () => {
          classifications += 1;
          return clean;
        },
      }),
      { classify: async () => ({ genuineApology: false, reason: 'no' }) },
    );

    expect(await runtime.bootstrap()).toBe(1);
    expect(await audit.hasBootstrap()).toBe(true);
    expect(await audit.cursor()).toBe(1);
    expect(classifications).toBe(0);
    expect(await runtime.bootstrap()).toBe(0);
  });

  test('audits only new participant messages, persists the OpenAI conversation id, and clears a temporary mute on a genuine apology', async () => {
    const { relay, audit } = await fixture();
    const first = message('m1', 'initial historic message', 100);
    await relay.sync([conversation([first])], 100);

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

    let muteClears = 0;
    const reputation = fakeReputation(() => { muteClears += 1; });
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
    expect(await runtime.bootstrap()).toBe(0);

    const modReply = message('m2', 'Please explain what happened.', 150, moderator);
    const apology = message('m3', 'I was wrong. I should not have spoken like that.', 200);
    await relay.sync([conversation([first, modReply, apology])], 200);
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

  test('resumes the same OpenAI conversation across later participant messages and intervening human moderator replies', async () => {
    const { relay, audit } = await fixture();
    const historic = message('m1', 'historic message', 100);
    await relay.sync([conversation([historic])], 100);

    const classifiers: Array<string | undefined> = [];
    const classified: ModerationItem[] = [];
    const runtime = new PrivateModmailRuntime(
      { key: 'test', model: 'test', effort: 'low' },
      relay,
      audit,
      fakeReputation(),
      conversationId => {
        classifiers.push(conversationId);
        return {
          conversationId: conversationId ?? 'conv_modmail_abc',
          classify: async item => {
            classified.push(item);
            return clean;
          },
        };
      },
      { classify: async () => ({ genuineApology: false, reason: 'no' }) },
    );
    await runtime.bootstrap();

    const userOne = message('m2', 'First live participant message.', 200);
    await relay.sync([conversation([historic, userOne])], 200);
    expect((await runtime.tick()).audited).toBe(1);

    const modReply = message('m3', 'Human moderator reply between user messages.', 250, moderator);
    const userTwo = message('m4', 'Second live participant message.', 300);
    await relay.sync([conversation([historic, userOne, modReply, userTwo])], 300);
    expect(await runtime.tick()).toMatchObject({ audited: 1, skipped: 1, failed: 0 });

    expect(classifiers).toEqual([undefined, 'conv_modmail_abc']);
    expect(classified).toHaveLength(2);
    expect(classified[1]?.text).toContain('Human moderator reply between user messages.');
    expect(classified[1]?.text).toContain('Second live participant message.');
    expect((await audit.conversation('abc'))?.openaiConversationId).toBe('conv_modmail_abc');
    expect(await audit.cursor()).toBe(3);
  });

  test('canonical moderators are skipped before the private LLM and reputation mutation boundaries', async () => {
    const { relay, audit } = await fixture();
    const historic = message('m1', 'historic message', 100);
    await relay.sync([conversation([historic])], 100);

    let classifierCalls = 0;
    let mutationCalls = 0;
    const reputation: PrivateModerationReputation = {
      user: async () => moderatorUser,
      hasContribution: async () => false,
      applyModeration: async () => {
        mutationCalls += 1;
        return moderatorUser;
      },
      clearMuteForConstructiveResolution: async () => false,
      raw: async (): Promise<Json> => ({
        users: { someuser: { points: 999_999_999, status: 'moderator' } },
        reputationJournal: {},
      }),
    };
    const runtime = new PrivateModmailRuntime(
      { key: 'test', model: 'test', effort: 'low' },
      relay,
      audit,
      reputation,
      () => ({
        conversationId: 'must-not-be-created',
        classify: async () => {
          classifierCalls += 1;
          return clean;
        },
      }),
      { classify: async () => ({ genuineApology: false, reason: 'no' }) },
    );
    await runtime.bootstrap();

    const live = message('m2', 'Participant identity is a canonical moderator.', 200);
    await relay.sync([conversation([historic, live])], 200);
    expect(await runtime.tick()).toEqual({ inspected: 1, audited: 0, apologies: 0, skipped: 1, failed: 0 });
    expect(classifierCalls).toBe(0);
    expect(mutationCalls).toBe(0);
    expect(await audit.cursor()).toBe(1);
    expect((await audit.conversation('abc'))?.openaiConversationId).toBeNull();
  });

  test('a failed participant audit does not advance past the failed event', async () => {
    const { relay, audit } = await fixture();
    const first = message('m1', 'initial historic message', 100);
    await relay.sync([conversation([first])], 100);
    const runtime = new PrivateModmailRuntime(
      { key: 'test', model: 'test', effort: 'low' },
      relay,
      audit,
      fakeReputation(),
      () => ({
        conversationId: undefined,
        classify: async () => { throw new Error('classifier unavailable'); },
      }),
      { classify: async () => ({ genuineApology: false, reason: 'no' }) },
    );
    await runtime.bootstrap();

    const second = message('m2', 'new participant message', 200);
    await relay.sync([conversation([first, second])], 200);
    expect((await runtime.tick()).failed).toBe(1);
    expect(await audit.cursor()).toBe(0);
  });
});