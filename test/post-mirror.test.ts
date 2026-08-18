import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BidirectionalPostMirror, type MirrorReader, type MirrorWriter } from '../src/mirror/service.ts';
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

const post = (
  subreddit: string,
  id: string,
  createdUtc: number,
  crosspostParent: string | null = null,
  selfText = '',
): RedditPost => ({
  id,
  fullname: `t3_${id}`,
  subreddit,
  title: `Post ${id}`,
  author: 'member',
  permalink: `/r/${subreddit}/comments/${id}/post_${id}/`,
  createdUtc,
  selfText,
  url: `https://www.reddit.com/r/${subreddit}/comments/${id}/post_${id}/`,
  flairTemplateId: null,
  flairText: null,
  stickied: false,
  locked: false,
  over18: false,
  crosspostParent,
});

class Reader implements MirrorReader {
  public nya: readonly RedditPost[] = [];
  public catgirl: readonly RedditPost[] = [];

  public async newPosts(subreddit: string): Promise<readonly RedditPost[]> {
    return subreddit === 'nyaonearth' ? this.nya : this.catgirl;
  }
}

type CrosspostCall = { target: string; source: string; title: string; created: RedditCreatedPost };

class Writer implements MirrorWriter {
  public readonly crossposts: CrosspostCall[] = [];
  public readonly fallbacks: { target: string; title: string; body: string }[] = [];

  public async crosspost(target: string, source: string, title: string): Promise<RedditCreatedPost> {
    const n = this.crossposts.length + 1;
    const created = { id: `mirror${n}`, fullname: `t3_mirror${n}`, url: '' };
    this.crossposts.push({ target, source, title, created });
    return created;
  }

  public async submitSelf(target: string, title: string, body: string): Promise<RedditCreatedPost> {
    const n = this.fallbacks.length + 1;
    this.fallbacks.push({ target, title, body });
    return { id: `fallback${n}`, fullname: `t3_fallback${n}`, url: '' };
  }
}

const mirror = async (): Promise<{ reader: Reader; writer: Writer; service: BidirectionalPostMirror }> => {
  const root = await mkdtemp(join(tmpdir(), 'mae-reddit-mirror-'));
  roots.push(root);
  const reader = new Reader();
  const writer = new Writer();
  const store = new PostMirrorStore(join(root, 'mirror.pb'));
  return {
    reader,
    writer,
    service: new BidirectionalPostMirror(reader, writer, store, 'nyaonearth', 'catgirlcoin'),
  };
};

describe('bidirectional subreddit post mirror', () => {
  test('first boot seeds both histories, then mirrors new posts once in each direction', async () => {
    const fixture = await mirror();
    fixture.reader.nya = [post('nyaonearth', 'nya-old', 100)];
    fixture.reader.catgirl = [post('catgirlcoin', 'cat-old', 100)];

    expect(await fixture.service.tick(1_000)).toEqual({ seeded: true, discovered: 0, completed: 0, failed: 0 });
    expect(fixture.writer.crossposts).toEqual([]);

    fixture.reader.nya = [post('nyaonearth', 'nya-new', 200), ...fixture.reader.nya];
    const nyaTick = await fixture.service.tick(2_000);
    expect(nyaTick.discovered).toBe(1);
    expect(nyaTick.completed).toBe(1);
    expect(fixture.writer.crossposts.map(call => [call.target, call.source])).toEqual([
      ['catgirlcoin', 't3_nya-new'],
    ]);

    fixture.reader.catgirl = [
      post('catgirlcoin', 'mirror1', 210, 't3_nya-new'),
      post('catgirlcoin', 'cat-new', 220),
      ...fixture.reader.catgirl,
    ];
    const catTick = await fixture.service.tick(3_000);
    expect(catTick.discovered).toBe(1);
    expect(catTick.completed).toBe(1);
    expect(fixture.writer.crossposts.map(call => [call.target, call.source])).toEqual([
      ['catgirlcoin', 't3_nya-new'],
      ['nyaonearth', 't3_cat-new'],
    ]);

    fixture.reader.nya = [
      post('nyaonearth', 'mirror2', 230, 't3_cat-new'),
      ...fixture.reader.nya,
    ];
    await fixture.service.tick(4_000);
    await fixture.service.tick(5_000);
    expect(fixture.writer.crossposts).toHaveLength(2);
    expect(fixture.writer.fallbacks).toHaveLength(0);
  });

  test('an already-crossposted pair is completed without circular reposting', async () => {
    const fixture = await mirror();
    fixture.reader.nya = [post('nyaonearth', 'old-nya', 100)];
    fixture.reader.catgirl = [post('catgirlcoin', 'old-cat', 100)];
    await fixture.service.tick(1_000);

    fixture.reader.nya = [post('nyaonearth', 'tweet-primary', 200), ...fixture.reader.nya];
    fixture.reader.catgirl = [
      post('catgirlcoin', 'tweet-crosspost', 201, 't3_tweet-primary'),
      ...fixture.reader.catgirl,
    ];
    const paired = await fixture.service.tick(2_000);

    expect(paired.completed).toBe(1);
    expect(paired.discovered).toBe(0);
    expect(fixture.writer.crossposts).toEqual([]);
    await fixture.service.tick(3_000);
    expect(fixture.writer.crossposts).toEqual([]);
  });

  test('a crosspost from outside the managed pair is still mirrored', async () => {
    const fixture = await mirror();
    fixture.reader.nya = [post('nyaonearth', 'old-nya', 100)];
    fixture.reader.catgirl = [post('catgirlcoin', 'old-cat', 100)];
    await fixture.service.tick(1_000);

    fixture.reader.catgirl = [
      post('catgirlcoin', 'external-crosspost', 200, 't3_some_other_subreddit_post'),
      ...fixture.reader.catgirl,
    ];
    const result = await fixture.service.tick(2_000);

    expect(result.discovered).toBe(1);
    expect(result.completed).toBe(1);
    expect(fixture.writer.crossposts.map(call => [call.target, call.source])).toEqual([
      ['nyaonearth', 't3_external-crosspost'],
    ]);
  });
});
