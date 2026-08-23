import { describe, expect, test } from 'bun:test';
import { DailyReviewClient, type DailyReviewFetch } from '../src/review/client.ts';

const cfg = { base: 'http://127.0.0.1:8766', token: 'review-secret' } as const;

describe('Daily Review client', () => {
  test('accepts only a loopback HTTP API', () => {
    expect(() => new DailyReviewClient({ base: 'https://example.com', token: 'x' })).toThrow();
    expect(() => new DailyReviewClient({ base: 'http://127.0.0.1:8766', token: '' })).toThrow();
  });

  test('returns null when the canonical review does not exist yet', async () => {
    const fetcher: DailyReviewFetch = async () => new Response('{"error":"review not found"}', { status: 404 });
    const client = new DailyReviewClient(cfg, fetcher);
    expect(await client.twitter('NyaOnEarth', '1234567890')).toBeNull();
  });

  test('decodes only the canonical Twitter decision payload and sends bearer auth', async () => {
    const fetcher: DailyReviewFetch = async (input, init) => {
      expect(String(input)).toContain('/v1/twitter/NyaOnEarth/1234567890');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer review-secret');
      return new Response(JSON.stringify({
        review: {
          key: 'twitter:nyaonearth:1234567890',
          account: 'NyaOnEarth',
          tweetId: '1234567890',
          decision: { choice: 'approve', at: 42 },
          applied: true,
        },
      }), { status: 200 });
    };
    const client = new DailyReviewClient(cfg, fetcher);
    expect(await client.twitter('NyaOnEarth', '1234567890')).toEqual({
      key: 'twitter:nyaonearth:1234567890',
      account: 'NyaOnEarth',
      tweetId: '1234567890',
      decision: { choice: 'approve', at: 42 },
      applied: true,
    });
  });

  test('decodes only approved and applied weekly summaries with attachment metadata', async () => {
    const fetcher: DailyReviewFetch = async (input, init) => {
      expect(String(input)).toContain('/v1/weekly?after=100');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer review-secret');
      return new Response(JSON.stringify({
        reviews: [{
          key: 'weekly:2026-08-23',
          weekStart: '2026-08-23',
          markdown: 'Weekly summary',
          decision: { choice: 'approve', at: 110 },
          applied: true,
          media: { kind: 'image', mime: 'image/png', size: 1234 },
        }],
      }), { status: 200 });
    };
    const client = new DailyReviewClient(cfg, fetcher);
    expect(await client.weekly(100)).toEqual([{
      key: 'weekly:2026-08-23',
      weekStart: '2026-08-23',
      markdown: 'Weekly summary',
      decision: { choice: 'approve', at: 110 },
      applied: true,
      media: { kind: 'image', mime: 'image/png', size: 1234 },
    }]);
  });

  test('rejects malformed weekly review states instead of posting them', async () => {
    const fetcher: DailyReviewFetch = async () => new Response(JSON.stringify({
      reviews: [{
        key: 'weekly:2026-08-23',
        weekStart: '2026-08-23',
        markdown: 'Not actually approved',
        decision: { choice: 'reject', at: 110 },
        applied: true,
        media: null,
      }],
    }));
    const client = new DailyReviewClient(cfg, fetcher);
    await expect(client.weekly()).rejects.toThrow('non-approved weekly review');
  });

  test('does not surface server response bodies or the bearer token in errors', async () => {
    const fetcher: DailyReviewFetch = async () => new Response('secret-bearing internal body', { status: 500 });
    const client = new DailyReviewClient(cfg, fetcher);
    try {
      await client.twitter('NyaOnEarth', '1234567890');
      throw new Error('expected request to fail');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('review-secret');
      expect(message).not.toContain('secret-bearing');
      expect(message).toContain('HTTP 500');
    }
  });
});
