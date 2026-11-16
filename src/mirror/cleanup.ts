import type { RedditPost } from '../reddit/types.ts';

export const mirrorCutoffUtc = Date.parse('2026-05-01T00:00:00Z') / 1_000;

export type StaleMaeCrosspost = {
  readonly post: RedditPost;
  readonly original: RedditPost;
  readonly ancestry: readonly string[];
};

export type UnresolvedMaeCrosspost = {
  readonly post: RedditPost;
  readonly sourceFullname: string;
};

export type MaeCrosspostCleanupPlan = {
  readonly scanned: number;
  readonly candidates: readonly StaleMaeCrosspost[];
  readonly unresolved: readonly UnresolvedMaeCrosspost[];
};

export type MaePostLookup = {
  postsByFullnames(fullnames: readonly string[]): Promise<readonly RedditPost[]>;
};

const postId = (value: string): boolean => /^t3_[A-Za-z0-9]+$/u.test(value);

export const sourcePostFullname = (post: RedditPost): string | null => {
  if (post.crosspostParent !== null) {
    return postId(post.crosspostParent) ? post.crosspostParent : null;
  }
  // Only Mae's own mirror fallback markers count. Ordinary links are not mirrors.
  const patterns = [
    /<!-- mae-mirror:v2:[A-Za-z0-9_]+:(t3_[A-Za-z0-9]+) -->/u,
    /<!-- mae-mirror:(t3_[A-Za-z0-9]+) -->/u,
    /<!-- mae-sticky-clone:(t3_[A-Za-z0-9]+) -->/u,
  ] as const;
  for (const pattern of patterns) {
    const match = pattern.exec(post.selfText);
    if (match?.[1] !== undefined) return match[1];
  }
  return null;
};

export const planStaleMaeCrossposts = async (
  posts: readonly RedditPost[],
  lookup: MaePostLookup,
  account = 'this_is_the_mae',
  subreddit = 'nyaonearth',
): Promise<MaeCrosspostCleanupPlan> => {
  const targets = new Map<string, RedditPost>();
  for (const post of posts) {
    if (
      postId(post.fullname)
      && post.author?.toLowerCase() === account.toLowerCase()
      && post.subreddit.toLowerCase() === subreddit.toLowerCase()
      && sourcePostFullname(post) !== null
    ) targets.set(post.fullname, post);
  }

  // Resolve parent chains in batches, rather than issuing one request per copy.
  const originals = new Map<string, RedditPost>();
  let frontier = new Set([...targets.values()]
    .map(sourcePostFullname)
    .filter((value): value is string => value !== null));
  for (let depth = 0; depth < 32 && frontier.size > 0; depth += 1) {
    const wanted = [...frontier].filter(id => !originals.has(id));
    if (wanted.length === 0) break;
    const found = await lookup.postsByFullnames(wanted);
    const next = new Set<string>();
    for (const post of found) {
      if (!wanted.includes(post.fullname)) continue;
      originals.set(post.fullname, post);
      const parent = sourcePostFullname(post);
      if (parent !== null && !originals.has(parent)) next.add(parent);
    }
    frontier = next;
  }

  const candidates: StaleMaeCrosspost[] = [];
  const unresolved: UnresolvedMaeCrosspost[] = [];
  for (const post of targets.values()) {
    let parent = sourcePostFullname(post);
    if (parent === null) continue;
    const visited = new Set<string>([post.fullname]);
    const ancestry: string[] = [];
    let root: RedditPost | null = null;
    let broken: string | null = null;
    for (let depth = 0; parent !== null && depth < 32; depth += 1) {
      if (visited.has(parent)) {
        broken = parent;
        break;
      }
      visited.add(parent);
      const source = originals.get(parent);
      if (source === undefined || !Number.isFinite(source.createdUtc) || source.createdUtc <= 0) {
        broken = parent;
        break;
      }
      root = source;
      ancestry.push(parent);
      parent = sourcePostFullname(source);
    }
    if (parent !== null && broken === null) broken = parent;
    if (broken !== null) {
      unresolved.push({ post, sourceFullname: broken });
    } else if (root !== null && root.createdUtc < mirrorCutoffUtc) {
      candidates.push({ post, original: root, ancestry });
    }
  }
  return { scanned: targets.size, candidates, unresolved };
};
