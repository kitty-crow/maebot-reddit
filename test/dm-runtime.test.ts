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
import {
  RedditDmRuntime,
  type DmReader,
  type DmReputation,
  type DmWriter,
} from '../src/dm/runtime.ts';
import type { ConversationDmResponder, DmReplyContext } from '../src/dm/reply.ts';
import { DmStore } from '../src/dm/store.ts';
import type { RedditDirectMessage } from '../src/dm/types.ts';
import type { ReputationUser } from '../src/reputation/store.ts';
import type { Json } from '../src/types/json.ts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
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

const user = (status: ReputationUser['status'] = 'ordinary'): ReputationUser => ({
  username: 'SomeUser',
  points: status === 'moderator' ? 999_999_999 : status === 'uncivil' ? -4 : 10,
  tier: status === 'moderator' ? 9 : status === 'ordinary' ? 2 : 0,
  status,
  currentFlairTemplateId: null,
  currentFlairText: null,
  currentFlairCssClass: null,
  desiredFlairTemplateId: null,
  desiredFlairText: null,
  immutableModeratorFlair: status === 'moderator',
  needsFlair: false,
  needsReview: false,
  source: status === 'moderator' ? 'moderator' : 'live-contribution',
  seededAt: 1,
});

const incoming = (
  id: string,
  body = 'Hello Mae',
  firstMessageFullname: string | null = null,
): RedditDirectMessage => ({
  id,
  fullname: `t4_${id}`,
  author: 'SomeUser',
  destination: 'this_is_the_mae',
  subject: 'Hello',
  body,
  createdUtc: Number(id.replace(/\D/gu, '')) || 100,
  parentFullname: null,
  firstMessageFullname,
  isNew: true,
  wasComment: false,
});

const sentReply = (id: string, parent: string, body: string): RedditDirectMessage => ({
  id,
  fullname: `t4_${id}`,
  author: 'this_is_the_mae',
  destination: 'SomeUser',
  subject: 're: Hello',
  body,
  createdUtc: 500,
  parentFullname: parent,
  firstMessageFullname: parent,
  isNew: false,
  wasComment: false,
});

type ReaderState = {
  history: RedditDirectMessage[];
  unread: RedditDirectMessage[];
  sent: RedditDirectMessage[];
};

const reader = (state: ReaderState): DmReader => ({
  directMessageHistory: async max => state.history.slice(0, max),
  unreadDirectMessages: async max => state.unread.slice(0, max),
  sentDirectMessages: async max => state.sent.slice(0, max),
});

type WriterState = {
  replies: Array<{ readonly fullname: string; readonly body: string }>;
  reads: string[];
};

const writer = (state: WriterState): DmWriter => ({
  replyToPrivateMessage: async (fullname, body) => { state.replies.push({ fullname, body }); },
  markPrivateMessageRead: async fullname => { state.reads.push(fullname); },
});

const reputation = (
  initial: ReputationUser,
  onClear: () => void = () => undefined,
  onApply: () => void = () => undefined,
): DmReputation => {
  const contributions = new Set<string>();
  return {
    user: async () => initial,
    hasContribution: async fullname => contributions.has(fullname),
    applyModeration: async input => {
      contributions.add(input.fullname);
      onApply();
      return initial;
    },
    clearMuteForConstructiveResolution: async () => {
      onClear();
      return true;
    },
    raw: async (): Promise<Json> => ({
      users: { someuser: { points: initial.points, status: initial.status } },
      reputationJournal: {},
    }),
  };
};

const store = async (): Promise<DmStore> => {
  const root = await mkdtemp(join(tmpdir(), 'mae-dm-runtime-'));
  roots.push(root);
  return new DmStore(join(root, 'dm.pb'));
};

const cfg = { key: 'test', model: 'test', effort: 'low' } as const;

const responder = (
  ids: Array<string | undefined>,
  contexts: DmReplyContext[],
  decision = { respond: true, text: 'Hi from Mae' } as const,
) => (conversationId: string | undefined): ConversationDmResponder => {
  ids.push(conversationId);
  return {
    conversationId: conversationId ?? 'conv_reply',
    reply: async context => {
      contexts.push(context);
      return decision;
    },
  };
};

describe('Reddit direct-message runtime', () => {
  test('first activation seeds history without retroactive moderation or replies, then processes a new DM exactly once', async () => {
    const dmStore = await store();
    const old = incoming('100');
    const state: ReaderState = { history: [old], unread: [old], sent: [] };
    const writes: WriterState = { replies: [], reads: [] };
    const moderationIds: Array<string | undefined> = [];
    const moderationItems: ModerationItem[] = [];
    const replyIds: Array<string | undefined> = [];
    const replyContexts: DmReplyContext[] = [];
    let mutations = 0;

    const runtime = new RedditDmRuntime(
      'catgirlcoin',
      'this_is_the_mae',
      cfg,
      cfg,
      'Mae persona',
      reader(state),
      writer(writes),
      dmStore,
      reputation(user(), () => undefined, () => { mutations += 1; }),
      null,
      conversationId => {
        moderationIds.push(conversationId);
        return {
          conversationId: conversationId ?? 'conv_mod',
          classify: async item => {
            moderationItems.push(item);
            return clean;
          },
        };
      },
      responder(replyIds, replyContexts),
      { classify: async () => ({ genuineApology: false, reason: 'no' }) },
    );

    expect(await runtime.bootstrap()).toBe(1);
    expect((await runtime.tick()).replies).toBe(0);
    expect(moderationItems).toHaveLength(0);
    expect(writes.replies).toHaveLength(0);

    const live = incoming('200', 'Can you help me?', old.fullname);
    state.unread = [live];
    const first = await runtime.tick();
    expect(first).toMatchObject({ inspected: 1, moderated: 1, replies: 1, noReply: 0, failed: 0 });
    expect(mutations).toBe(1);
    expect(moderationItems).toHaveLength(1);
    expect(moderationItems[0]?.kind).toBe('dm');
    expect(moderationIds).toEqual([undefined]);
    expect(replyIds).toEqual([undefined]);
    expect(replyContexts[0]?.message.fullname).toBe(live.fullname);
    expect(writes.replies).toEqual([{ fullname: live.fullname, body: 'Hi from Mae' }]);
    expect(writes.reads).toContain(live.fullname);
    expect(await dmStore.conversation(old.fullname, 'SomeUser')).toEqual({
      username: 'SomeUser',
      moderationConversationId: 'conv_mod',
      responseConversationId: 'conv_reply',
    });

    const repeated = await runtime.tick();
    expect(repeated.replies).toBe(0);
    expect(writes.replies).toHaveLength(1);
    expect(moderationItems).toHaveLength(1);
  });

  test('recovers a crash after Reddit accepted a reply without sending it twice', async () => {
    const dmStore = await store();
    await dmStore.seed([], 1);
    const live = incoming('300', 'Ping');
    await dmStore.begin(live);
    await dmStore.setClassification(live.fullname, clean);
    await dmStore.markModerated(live.fullname);
    await dmStore.setReply(live.fullname, 'Recovered reply');
    await dmStore.markAttempted(live.fullname);

    const state: ReaderState = {
      history: [],
      unread: [live],
      sent: [sentReply('301', live.fullname, 'Recovered reply')],
    };
    const writes: WriterState = { replies: [], reads: [] };
    const runtime = new RedditDmRuntime(
      'catgirlcoin', 'this_is_the_mae', cfg, cfg, 'Mae persona',
      reader(state), writer(writes), dmStore, reputation(user()),
      null,
      () => { throw new Error('moderation must not rerun'); },
      () => { throw new Error('reply generation must not rerun'); },
      { classify: async () => ({ genuineApology: false, reason: 'no' }) },
    );

    const result = await runtime.tick();
    expect(result.recovered).toBe(1);
    expect(result.replies).toBe(0);
    expect(writes.replies).toEqual([]);
    expect((await dmStore.state(live.fullname))?.delivery).toBe('sent');
    expect(writes.reads).toContain(live.fullname);
  });

  test('blocks an uncertain attempted delivery instead of risking a duplicate Reddit reply', async () => {
    const dmStore = await store();
    await dmStore.seed([], 1);
    const live = incoming('400', 'Ping');
    await dmStore.begin(live);
    await dmStore.setClassification(live.fullname, clean);
    await dmStore.markModerated(live.fullname);
    await dmStore.setReply(live.fullname, 'Maybe already sent');
    await dmStore.markAttempted(live.fullname);

    const state: ReaderState = { history: [], unread: [live], sent: [] };
    const writes: WriterState = { replies: [], reads: [] };
    const runtime = new RedditDmRuntime(
      'catgirlcoin', 'this_is_the_mae', cfg, cfg, 'Mae persona',
      reader(state), writer(writes), dmStore, reputation(user()),
      null,
      () => { throw new Error('moderation must not rerun'); },
      () => { throw new Error('reply generation must not rerun'); },
      { classify: async () => ({ genuineApology: false, reason: 'no' }) },
    );

    const result = await runtime.tick();
    expect(result.uncertain).toBe(1);
    expect(result.replies).toBe(0);
    expect(writes.replies).toEqual([]);
    expect((await dmStore.state(live.fullname))?.delivery).toBe('attempted');
  });

  test('a genuine clean private apology clears the temporary mute without awarding reputation', async () => {
    const dmStore = await store();
    await dmStore.seed([], 1);
    const live = incoming('500', 'I was wrong. I should not have spoken to you like that.');
    const state: ReaderState = { history: [], unread: [live], sent: [] };
    const writes: WriterState = { replies: [], reads: [] };
    let clears = 0;
    let mutations = 0;
    const resolution: PrivateResolutionClassifier = {
      classify: async () => ({ genuineApology: true, reason: 'sincere acknowledgement' }),
    };
    const runtime = new RedditDmRuntime(
      'catgirlcoin', 'this_is_the_mae', cfg, cfg, 'Mae persona',
      reader(state), writer(writes), dmStore,
      reputation(user('uncivil'), () => { clears += 1; }, () => { mutations += 1; }),
      null,
      (): ConversationModerationClassifier => ({ conversationId: 'conv_mod', classify: async () => clean }),
      responder([], [], { respond: false, text: '' }),
      resolution,
    );

    const result = await runtime.tick();
    expect(result).toMatchObject({ moderated: 1, apologies: 1, replies: 0, noReply: 1, failed: 0 });
    expect(clears).toBe(1);
    expect(mutations).toBe(1);
  });

  test('canonical moderators bypass private semantic moderation and reputation mutation but may still converse with Mae', async () => {
    const dmStore = await store();
    await dmStore.seed([], 1);
    const live = incoming('600', 'Hi Mae');
    const state: ReaderState = { history: [], unread: [live], sent: [] };
    const writes: WriterState = { replies: [], reads: [] };
    let moderationCalls = 0;
    let mutationCalls = 0;
    const runtime = new RedditDmRuntime(
      'catgirlcoin', 'this_is_the_mae', cfg, cfg, 'Mae persona',
      reader(state), writer(writes), dmStore,
      reputation(user('moderator'), () => undefined, () => { mutationCalls += 1; }),
      null,
      () => ({
        conversationId: 'must-not-exist',
        classify: async () => {
          moderationCalls += 1;
          return clean;
        },
      }),
      responder([], []),
      { classify: async () => ({ genuineApology: false, reason: 'no' }) },
    );

    const result = await runtime.tick();
    expect(result).toMatchObject({ moderated: 0, replies: 1, failed: 0 });
    expect(moderationCalls).toBe(0);
    expect(mutationCalls).toBe(0);
    expect(writes.replies).toHaveLength(1);
  });
});
