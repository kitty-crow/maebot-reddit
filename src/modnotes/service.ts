import { resolve } from 'node:path';
import { redditConfig, redditModerationConfig } from '../env.ts';
import { ReputationStore } from '../reputation/store.ts';
import { RedditReadClient } from '../reddit/client.ts';
import { safeError } from '../reddit/error.ts';
import { MemberContributionAssessor } from './assessor.ts';
import { MemberModNotesRedditClient } from './reddit.ts';
import { MemberModNoteRuntime } from './runtime.ts';
import { MemberModNoteStore } from './store.ts';
import { MemberModNoteWatchRuntime } from './watch.ts';

const canonicalCommunities = ['catgirlcoin', 'nyaonearth'] as const;

const pollMs = (): number => {
  const raw = process.env['REDDIT_MEMBER_MOD_NOTES_POLL_MS']?.trim();
  const value = raw === undefined || raw.length === 0 ? 15_000 : Number(raw);
  if (!Number.isSafeInteger(value) || value < 5_000) {
    throw new Error('REDDIT_MEMBER_MOD_NOTES_POLL_MS must be an integer of at least 5000');
  }
  return value;
};

export type StopMemberModNoteService = () => void;

export const startMemberModNoteService = async (): Promise<StopMemberModNoteService> => {
  const moderationCfg = redditModerationConfig();
  if (moderationCfg === null) {
    console.log('Member Mod Note live maintenance is disabled because Reddit moderation is disabled.');
    return () => {};
  }

  const redditCfg = redditConfig();
  const reputation = new ReputationStore(moderationCfg.stateFile);
  const reader = new RedditReadClient(redditCfg.auth);
  const store = new MemberModNoteStore(resolve(
    process.cwd(),
    process.env['REDDIT_MEMBER_MOD_NOTES_FILE']?.trim() || 'data/memberModNotes.pb',
  ));
  const remote = new MemberModNotesRedditClient(redditCfg.auth);
  const assessor = new MemberContributionAssessor(moderationCfg.ai);
  const notes = new MemberModNoteRuntime(
    canonicalCommunities,
    store,
    reputation,
    assessor,
    remote,
  );
  const watcher = new MemberModNoteWatchRuntime(
    canonicalCommunities,
    moderationCfg,
    reader,
    reputation,
    notes,
    resolve(
      process.cwd(),
      process.env['REDDIT_MEMBER_MOD_NOTE_WATCH_FILE']?.trim() || 'data/memberModNoteWatch.pb',
    ),
  );

  const interval = pollMs();
  try {
    const primed = await watcher.tick();
    console.log(
      `Member Mod Note live boundary established across ${canonicalCommunities.map(value => `r/${value}`).join(' + ')}; seeded=${primed.seeded}, poll=${interval}ms.`,
    );
  } catch (error) {
    console.error(`[Reddit member notes] startup prime failed: ${safeError(error)}`);
  }

  let ticking = false;
  const tick = async (): Promise<void> => {
    if (ticking) return;
    ticking = true;
    try {
      const result = await watcher.tick();
      if (result.updated > 0 || result.failed > 0) {
        console.log(
          `[Reddit member notes] discovered=${result.discovered} updated=${result.updated} skipped=${result.skipped} failed=${result.failed}`,
        );
      }
    } catch (error) {
      console.error(`[Reddit member notes] tick failed: ${safeError(error)}`);
    } finally {
      ticking = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, interval);

  return () => clearInterval(timer);
};
