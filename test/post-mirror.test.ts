import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrimaryPostMirror, type MirrorReader, type MirrorWriter } from '../src/mirror/service.ts';
import { PostMirrorStore } from '../src/mirror/store.ts';
import type { RedditCreatedPost } from '../src/reddit/mutate.ts';
import type { RedditPost } from '../src/reddit/types.ts';

const roots: string[] = [];
afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  }
});

const post = (id: string, createdUtc: number, crosspostParent: string | null = null): RedditPost => ({
  id,
  fullname: `t3_${id}`,
  subreddit: 'nyaonearth',
  title: `Post ${id}`,
  author: 'member',
  permalink: `/r/nyaonearth/comments/${id}/post_${id}/`,
  createdUtc,
  selfText: '',
  url: `https://www.reddit.com/r/nyaonearth/comments/${id}/post_${id}/`,
  flairTemplateId: null,
  flairText: null,
  stickied: false,
  locked: false,
  over18: false,
  crosspostParent,
});

class Reader implements MirrorReader {
  public primary: readonly RedditPost[] = [];
  public legacy: readonly RedditPost[] = [];

  public async newPosts(subreddit: string): Promise<readonly RedditPost[]> {
    return subreddit === 'nyaonearth' ? this.primary : this.legacy;
  }
}

class Writer implements MirrorWriter {
  public readonly crossposts: string[] = [];
  public readonly fallbacks: string[] = [];

  public async crosspost(_subreddit: string, sourcePostId: string): Promise<RedditCreatedPost> {
    this.crossposts.push(sourcePostId);
    return { id: `legacy-${this.crossposts.length}`, fullname: `t3_legacy-${this.crossposts.length}`, url: '' };
  }

  public async submitSelf(_subreddit: string, title: string): Promise<RedditCreatedPost> {
    this.fallbacks.push(title);
    return { id: `fallback-${this.fallbacks.length}`, fullname: `t3_fallback-${this.fallbacks.length}`, url: '' };
  }
}

const mirror = async (): Promise<{ reader: Reader; writer: Writer; service: PrimaryPostMirror }> => {
  const root = await mkdtemp(join(tmpdir(), 'mae-reddit-mirror-'));
  roots.push(root);
  const reader = new Reader();
  const writer = new Writer();
  const store = new PostMirrorStore(join(root, 'mirror.pb'));
  return {
    reader,
    writer,
    service: new PrimaryPostMirror(reader, writer, store, 'nyaonearth', 'catgirlcoin'),
  };
};

describe('all-user subreddit post mirror', () => {
  test('first boot seeds current history and only mirrors later primary posts', async () => {
    const fixture = await mirror();
    fixture.reader.primary = [post('old', 100)];

    expect(await fixture.service.tick(1_000)).toEqual({ seeded: true, discovered: 0, completed: 0, failed: 0 });
    expect(fixture.writer.crossposts).toEqual([]);

    fixture.reader.primary = [post('new', 200), post('old', 100)];
    const next = await fixture.service.tick(2_000);
    expect(next.seeded).toBe(false);
    expect(next.discovered).toBe(1);
    expect(next.completed).toBe(1);
    expect(next.failed).toBe(0);
    expect(fixture.writer.crossposts).toEqual(['t3_new']);

    await fixture.service.tick(3_000);
    expect(fixture.writer.crossposts).toEqual(['t3_new']);
  });

  test('existing legacy crosspost is recorded instead of duplicated', async () => {
    const fixture = await mirror();
    fixture.reader.primary = [post('old', 100)];
    await fixture.service.tick(1_000);

    fixture.reader.primary = [post('new', 200), post('old', 100)];
    fixture.reader.legacy = [{ ...post('legacy', 210, 't3_new'), subreddit: 'catgirlcoin' }];
    const result = await fixture.service.tick(2_000);

    expect(result.completed).toBe(1);
    expect(result.failed).toBe(0);
    expect(fixture.writer.crossposts).toEqual([]);
    expect(fixture.writer.fallbacks).toEqual([]);
  });
});
