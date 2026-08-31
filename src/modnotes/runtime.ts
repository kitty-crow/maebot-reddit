import type { ModerationClassification } from '../mod/classifier.ts';
import { safeError } from '../reddit/error.ts';
import {
  MemberContributionAssessor,
  memberModNoteText,
  type MemberActivityAssessment,
} from './assessor.ts';
import type { MemberModNotesRedditClient } from './reddit.ts';
import { MemberModNoteStore, type MemberModNoteRecord } from './store.ts';

export type MemberModNoteScore = {
  readonly points: number;
  readonly status?: string;
};

export type MemberModNoteScoreReader = {
  user(username: string): Promise<MemberModNoteScore | null>;
};

export type MemberModNoteActivity = {
  readonly fullname: string;
  readonly kind: 'post' | 'comment';
  readonly subreddit: string;
  readonly author: string;
  readonly text: string;
  readonly classification: ModerationClassification;
};

export type MemberModNoteUpdateResult = {
  readonly updated: boolean;
  readonly posted: number;
  readonly deleted: number;
  readonly failed: number;
};

export type MemberModNoteRemote = Pick<MemberModNotesRedditClient, 'addModNote' | 'deleteModNote'>;

const communities = (input: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const value = raw.trim().replace(/^r\//iu, '');
    if (value.length === 0) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  if (out.length === 0) throw new Error('Member Mod Notes runtime requires at least one community');
  return out;
};

const previousNativeId = (record: MemberModNoteRecord | null, subreddit: string): string | null =>
  record?.nativeNotes.find(entry => entry.subreddit.toLowerCase() === subreddit.toLowerCase())?.noteId ?? null;

const contextFullnames = (record: MemberModNoteRecord | null, fullname: string): readonly string[] => {
  const values = record?.sampledCommentFullnames ?? [];
  const out = [...values.filter(value => value !== fullname), fullname];
  return out.slice(Math.max(0, out.length - 64));
};

export class MemberModNoteRuntime {
  private readonly communities: readonly string[];

  public constructor(
    moderatedCommunities: readonly string[],
    private readonly store: MemberModNoteStore,
    private readonly scores: MemberModNoteScoreReader,
    private readonly assessor: MemberContributionAssessor,
    private readonly reddit: MemberModNoteRemote,
  ) {
    this.communities = communities(moderatedCommunities);
  }

  public async observe(activity: MemberModNoteActivity): Promise<MemberModNoteUpdateResult> {
    const author = activity.author.trim();
    if (author.length === 0) throw new Error('Member Mod Note activity requires an author');

    const previous = await this.store.record(author);
    if (previous?.sampledCommentFullnames.includes(activity.fullname) === true) {
      return { updated: false, posted: 0, deleted: 0, failed: 0 };
    }

    const score = await this.scores.user(author);
    if (score === null) throw new Error(`Member Mod Notes could not read score for u/${author}`);

    const assessedActivity: MemberActivityAssessment = {
      fullname: activity.fullname,
      kind: activity.kind,
      subreddit: activity.subreddit,
      text: activity.text,
      classification: activity.classification,
    };
    const profile = await this.assessor.update(
      author,
      {
        summary: previous?.summary ?? null,
        label: previous?.label ?? null,
      },
      assessedActivity,
    );
    const note = memberModNoteText(score.points, profile.summary);
    await this.store.generated(
      author,
      note,
      profile.summary,
      profile.label,
      contextFullnames(previous, activity.fullname),
      Math.floor(Date.now() / 1_000),
    );

    let posted = 0;
    let deleted = 0;
    let failed = 0;
    const failures: string[] = [];

    for (const community of this.communities) {
      const oldId = previousNativeId(previous, community);
      try {
        const newId = await this.reddit.addModNote(
          community,
          author,
          note,
          profile.label,
          activity.fullname,
        );
        await this.store.markNativeNote(author, community, newId);
        await this.store.markApplied(author, community);
        posted += 1;

        if (oldId !== null && oldId !== newId) {
          try {
            await this.reddit.deleteModNote(community, author, oldId);
            deleted += 1;
          } catch (error) {
            failed += 1;
            failures.push(`r/${community} old-note delete: ${safeError(error)}`);
          }
        }
      } catch (error) {
        failed += 1;
        failures.push(`r/${community} replacement post: ${safeError(error)}`);
      }
    }

    if (failures.length > 0) await this.store.failed(author, failures.join(' | '));
    return { updated: true, posted, deleted, failed };
  }
}
