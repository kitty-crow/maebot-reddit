import { expect, test } from 'bun:test';
import {
  redditStateAdoptionInProgress,
  withRedditStateAdoption,
} from '../src/reputation/manualOverrideGate.ts';
import { RedditMutationClient, type RedditMutationFetch } from '../src/reddit/mutate.ts';

const auth = {
  clientId: 'synthetic-client',
  clientSecret: 'synthetic-secret',
  username: 'this_is_the_mae',
  password: 'synthetic-password',
  userAgent: 'linux:test:0.0.0 (by /u/this_is_the_mae)',
};

test('live-state adoption blocks normal mutations only for the selected user', async () => {
  let fetchCalls = 0;
  const fetcher: RedditMutationFetch = async () => {
    fetchCalls += 1;
    return new Response('{}', { status: 500 });
  };
  const writer = new RedditMutationClient(auth, { fetcher, maxAttempts: 1 });

  expect(redditStateAdoptionInProgress('Zeuve')).toBe(false);
  await withRedditStateAdoption('Zeuve', async () => {
    expect(redditStateAdoptionInProgress('zeuve')).toBe(true);
    await expect(writer.banUser('catgirlcoin', 'Zeuve', 'reason', 'note')).rejects.toThrow(
      'Live Reddit state adoption is in progress for u/Zeuve',
    );
    expect(redditStateAdoptionInProgress('someone-else')).toBe(false);
  });
  expect(redditStateAdoptionInProgress('Zeuve')).toBe(false);
  expect(fetchCalls).toBe(0);
});

test('adoption gate always releases after a failed snapshot', async () => {
  await expect(withRedditStateAdoption('Zeuve', async () => {
    throw new Error('snapshot failed');
  })).rejects.toThrow('snapshot failed');
  expect(redditStateAdoptionInProgress('Zeuve')).toBe(false);
});
