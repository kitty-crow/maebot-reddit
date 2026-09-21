import type { RedditAuthCfg } from '../env.ts';
import { RedditReadClient } from '../reddit/client.ts';
import {
  devvitRpcClient,
  redditCall,
  wireMap,
  wireText,
} from '../reddit/devvitCompat.ts';
import { DevvitRpcClient } from '../reddit/devvitRpc.ts';
import type { RedditComment } from '../reddit/types.ts';
import type { MemberModNoteLabel } from './store.ts';

export type MemberModNotesFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type MemberModNotesRedditOptions = {
  readonly fetcher?: MemberModNotesFetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly random?: () => number;
  readonly maxAttempts?: number;
  readonly rateReserve?: number;
  readonly rpc?: DevvitRpcClient;
};

export class MemberModNotesRedditClient {
  private readonly rpc: DevvitRpcClient;
  private readonly read: RedditReadClient;

  public constructor(
    cfg: RedditAuthCfg,
    options: MemberModNotesRedditOptions = {},
  ) {
    this.rpc = options.rpc ?? devvitRpcClient(cfg);
    this.read = new RedditReadClient(cfg, { rpc: this.rpc });
  }

  public async recentCommentsInCommunities(
    rawUsername: string,
    communities: readonly string[],
    limit = 10,
    maxScanned = 1_000,
  ): Promise<readonly RedditComment[]> {
    const username = rawUsername.trim().replace(/^u//iu, '').toLowerCase();
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const safeMax = Math.max(safeLimit, Math.min(1_000, Math.floor(maxScanned)));
    const batches = await Promise.all(communities.map(async community =>
      await this.read.newCommentsHistory(community, safeMax)));
    return batches
      .flat()
      .filter(comment => comment.author?.toLowerCase() === username)
      .sort((left, right) => right.createdUtc - left.createdUtc || right.fullname.localeCompare(left.fullname))
      .slice(0, safeLimit);
  }

  public async addModNote(
    rawSubreddit: string,
    rawUsername: string,
    note: string,
    label: MemberModNoteLabel,
    redditId?: string,
  ): Promise<string> {
    const subreddit = rawSubreddit.trim().replace(/^r//iu, '');
    const user = rawUsername.trim().replace(/^u//iu, '');
    const text = note.trim();
    if (text.length < 1 || text.length > 250) {
      throw new Error('Reddit Mod Note text must be from 1 to 250 characters');
    }
    const raw = wireMap(await redditCall(this.rpc, 'addModNote', [{
      subreddit,
      user,
      note: text,
      ...(label === 'NONE' ? {} : { label }),
      ...(redditId === undefined ? {} : { redditId }),
    }]), 'Devvit created mod note');
    return wireText(raw['id'], 'Devvit created mod note id');
  }

  public async deleteModNote(
    rawSubreddit: string,
    rawUsername: string,
    rawNoteId: string,
  ): Promise<void> {
    const subreddit = rawSubreddit.trim().replace(/^r//iu, '');
    const user = rawUsername.trim().replace(/^u//iu, '');
    const noteId = rawNoteId.trim();
    if (!noteId.startsWith('ModNote_')) throw new Error(`Invalid native Mod Note id ${rawNoteId}`);
    await redditCall(this.rpc, 'deleteModNote', [{ subreddit, user, noteId }]);
  }
}
