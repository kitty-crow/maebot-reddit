import { describe, expect, test } from 'bun:test';
import {
  DAILY_TASK_HIGHLIGHT_EXPIRES_AT,
  DAILY_TASK_HIGHLIGHT_LABEL,
} from '../src/daily/redditPolicy.ts';
import type { RedditAuthCfg } from '../src/env.ts';
import { RedditMutationClient, type RedditMutationFetch } from '../src/reddit/mutate.ts';
import {
  MAJOR_ANNOUNCEMENT_FLAIR,
  MINOR_ANNOUNCEMENT_FLAIR,
  twitterAnnouncementFlair,
} from '../src/twitter/flair.ts';

const auth: RedditAuthCfg = {
  clientId: 'client',
  clientSecret: 'secret',
  username: 'mae',
  password: 'password',
  userAgent: 'mae-test',
};

describe('Twitter Reddit announcement flair policy', () => {
  test('maps Daily Task-worthy tweets to the major announcement flair', () => {
    expect(twitterAnnouncementFlair(true)).toBe(MAJOR_ANNOUNCEMENT_FLAIR);
    expect(MAJOR_ANNOUNCEMENT_FLAIR).toBe('Announcement :catgirl-moon:');
  });

  test('promoted Daily Tasks use the Announcement highlight with no expiry', () => {
    expect(DAILY_TASK_HIGHLIGHT_LABEL).toBe('Announcement');
    expect(DAILY_TASK_HIGHLIGHT_EXPIRES_AT).toBeNull();
  });

  test('maps ordinary tweets to the minor announcement flair', () => {
    expect(twitterAnnouncementFlair(false)).toBe(MINOR_ANNOUNCEMENT_FLAIR);
    expect(MINOR_ANNOUNCEMENT_FLAIR).toBe('Minor Announcement :lisa:');
  });

  test('refuses to guess a flair before classification is complete', () => {
    expect(() => twitterAnnouncementFlair(null)).toThrow('completed Daily Task classification');
  });

  test('submits the flair template id atomically with the Reddit post', async () => {
    let submitBody = '';
    const fetcher: RedditMutationFetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/api/v1/access_token')) {
        return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 });
      }
      if (url.includes('/api/submit')) {
        submitBody = init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body ?? '');
        return new Response(JSON.stringify({
          json: {
            errors: [],
            data: { id: 'abc123', name: 't3_abc123', url: 'https://reddit.test/abc123' },
          },
        }), { status: 200 });
      }
      return new Response('', { status: 404 });
    };

    const client = new RedditMutationClient(auth, { fetcher, maxAttempts: 1 });
    const created = await client.submitSelf('catgirlcoin', 'title', 'body', 'flair-template-id');

    expect(created.id).toBe('abc123');
    const form = new URLSearchParams(submitBody);
    expect(form.get('sr')).toBe('catgirlcoin');
    expect(form.get('flair_id')).toBe('flair-template-id');
    expect(form.get('kind')).toBe('self');
  });

  test('highlight mutation supports four slots and explicit removal', async () => {
    const bodies: URLSearchParams[] = [];
    const fetcher: RedditMutationFetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/api/v1/access_token')) {
        return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 });
      }
      if (url.includes('/api/set_subreddit_sticky')) {
        const body = init?.body instanceof URLSearchParams
          ? new URLSearchParams(init.body)
          : new URLSearchParams(String(init?.body ?? ''));
        bodies.push(body);
        return new Response('', { status: 200 });
      }
      return new Response('', { status: 404 });
    };

    const client = new RedditMutationClient(auth, { fetcher, maxAttempts: 1 });
    await client.sticky('abc123', 4);
    await client.unsticky('abc123');

    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.get('id')).toBe('t3_abc123');
    expect(bodies[0]?.get('num')).toBe('4');
    expect(bodies[0]?.get('state')).toBe('true');
    expect(bodies[1]?.get('id')).toBe('t3_abc123');
    expect(bodies[1]?.get('num')).toBeNull();
    expect(bodies[1]?.get('state')).toBe('false');
  });
});
