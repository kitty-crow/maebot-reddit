import { describe, expect, test } from 'bun:test';
import {
  mirrorCutoffUtc,
  planStaleMaeCrossposts,
  sourcePostFullname,
  type MaePostLookup,
} from '../src/mirror/cleanup.ts';
import type { RedditPost } from '../src/reddit/types.ts';

const post = (
  id: string,
  createdUtc: number,
  options: {
    subreddit?: string;
    author?: string;
    parent?: string | null;
    selfText?: string;
  } = {},
): RedditPost => ({
  id,
  fullname: `t3_${id}`,
  subreddit: options.subreddit ?? 'nyaonearth',
  title: `Post ${id}`,
  author: options.author ?? 'this_is_the_mae',
  permalink: `/r/${options.subreddit ?? 'nyaonearth'}/comments/${id}/post/`,
  createdUtc,
  selfText: options.selfText ?? '',
  url: '',
  flairTemplateId: null,
  flairText: null,
  stickied: false,
  locked: false,
  over18: false,
  crosspostParent: options.parent ?? null,
  score: 0,
  mediaUrls: [],
});

class Lookup implements MaePostLookup {
  public readonly requested: string[][] = [];
  public constructor(private readonly indexed: readonly RedditPost[]) {}

  public async postsByFullnames(ids: readonly string[]): Promise<readonly RedditPost[]> {
    this.requested.push([...ids]);
    return this.indexed.filter(item => ids.includes(item.fullname));
  }
}

describe('Mae historical cross-post cleanup', () => {
  test('removes only Mae-owned r/nyaonearth crossposts with pre-May originals', async () => {
    const old = post('old', mirrorCutoffUtc - 1, { subreddit: 'catgirlcoin', author: 'member' });
    const boundary = post('boundary', mirrorCutoffUtc, { subreddit: 'catgirlcoin', author: 'member' });
    const recent = post('recent', mirrorCutoffUtc + 1, { subreddit: 'catgirlcoin', author: 'member' });
    const posts = [
      post('bad', mirrorCutoffUtc + 100, { parent: old.fullname }),
      post('fineboundary', mirrorCutoffUtc + 100, { parent: boundary.fullname }),
      post('finerecent', mirrorCutoffUtc + 100, { parent: recent.fullname }),
      post('notmae', mirrorCutoffUtc + 100, { parent: old.fullname, author: 'someoneelse' }),
      post('wrongsub', mirrorCutoffUtc + 100, { parent: old.fullname, subreddit: 'catgirlcoin' }),
      post('ordinary', mirrorCutoffUtc + 100),
    ];
    const lookup = new Lookup([old, boundary, recent]);
    const result = await planStaleMaeCrossposts(posts, lookup);
    expect(result.candidates.map(item => item.post.fullname)).toEqual(['t3_bad']);
    expect(result.candidates[0]?.original.fullname).toBe('t3_old');
    expect(result.unresolved).toEqual([]);
    expect(result.scanned).toBe(3);
  });

  test('follows nested crossposts to the true oldest original', async () => {
    const original = post('original', mirrorCutoffUtc - 60, { subreddit: 'catgirlcoin', author: 'member' });
    const intermediate = post('intermediate', mirrorCutoffUtc + 10, {
      subreddit: 'catgirlcoin',
      author: 'other',
      parent: original.fullname,
    });
    const copy = post('copy', mirrorCutoffUtc + 20, { parent: intermediate.fullname });
    const result = await planStaleMaeCrossposts([copy], new Lookup([intermediate, original]));
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.original.fullname).toBe(original.fullname);
    expect(result.candidates[0]?.ancestry).toEqual(['t3_intermediate', 't3_original']);
  });

  test('includes Mae mirror and sticky fallback posts but excludes ordinary links', async () => {
    const original = post('original', mirrorCutoffUtc - 10, { subreddit: 'catgirlcoin' });
    const fallback = post('fallback', mirrorCutoffUtc + 10, {
      selfText: '<!-- mae-mirror:v2:catgirlcoin:t3_original -->',
    });
    const legacy = post('legacy', mirrorCutoffUtc + 10, {
      selfText: '<!-- mae-mirror:t3_original -->',
    });
    const sticky = post('sticky', mirrorCutoffUtc + 10, {
      selfText: '<!-- mae-sticky-clone:t3_original -->',
    });
    const innocent = post('innocent', mirrorCutoffUtc + 10, {
      selfText: 'An ordinary link to https://www.reddit.com/comments/original',
    });
    expect(sourcePostFullname(innocent)).toBeNull();
    const result = await planStaleMaeCrossposts([fallback, legacy, sticky, innocent], new Lookup([original]));
    expect(result.candidates.map(item => item.post.id)).toEqual(['fallback', 'legacy', 'sticky']);
  });

  test('never deletes when original cannot be verified', async () => {
    const unknown = post('unknown', mirrorCutoffUtc + 10, { parent: 't3_unavailable' });
    const result = await planStaleMaeCrossposts([unknown], new Lookup([]));
    expect(result.candidates).toEqual([]);
    expect(result.unresolved.map(item => item.sourceFullname)).toEqual(['t3_unavailable']);
  });

  test('does not accept cycles as verified original history', async () => {
    const first = post('first', mirrorCutoffUtc + 10, { parent: 't3_second' });
    const second = post('second', mirrorCutoffUtc + 10, { parent: 't3_first' });
    const result = await planStaleMaeCrossposts([first], new Lookup([first, second]));
    expect(result.candidates).toEqual([]);
    expect(result.unresolved).toHaveLength(1);
  });
});
