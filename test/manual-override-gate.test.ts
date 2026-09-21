import { expect, test } from 'bun:test';
import {
  redditStateAdoptionInProgress,
  withRedditStateAdoption,
} from '../src/reputation/manualOverrideGate.ts';
import { RedditMutationClient } from '../src/reddit/mutate.ts';

const auth = {
  username: 'this_is_the_mae',
  devvitRpcStateFile: '/tmp/mae-manual-override-never-used.pb',
  devvitRpcTimeoutMs: 50,
};

test('live-state adoption blocks normal mutations only for the selected user', async () => {
  const writer = new RedditMutationClient(auth);

  expect(redditStateAdoptionInProgress('Zeuve')).toBe(false);
  await withRedditStateAdoption('Zeuve', async () => {
    expect(redditStateAdoptionInProgress('zeuve')).toBe(true);
    await expect(writer.banUser('catgirlcoin', 'Zeuve', 'reason', 'note')).rejects.toThrow(
      'Live Reddit state adoption is in progress for u/Zeuve',
    );
    expect(redditStateAdoptionInProgress('someone-else')).toBe(false);
  });
  expect(redditStateAdoptionInProgress('Zeuve')).toBe(false);
});

test('adoption gate always releases after a failed snapshot', async () => {
  await expect(withRedditStateAdoption('Zeuve', async () => {
    throw new Error('snapshot failed');
  })).rejects.toThrow('snapshot failed');
  expect(redditStateAdoptionInProgress('Zeuve')).toBe(false);
});
