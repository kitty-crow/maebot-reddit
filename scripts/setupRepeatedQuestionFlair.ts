import 'dotenv/config';
import { redditConfig, type RedditAuthCfg } from '../src/env.ts';
import {
  ensureRepeatedQuestionFlair,
  REPEATED_QUESTION_FLAIR_TEXT,
} from '../src/posts/organisation.ts';
import { RedditReadClient } from '../src/reddit/client.ts';
import { RedditMutationClient } from '../src/reddit/mutate.ts';

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
};

const base = redditConfig();
const admin: RedditAuthCfg = {
  ...base.auth,
  username: required('REDDIT_ADMIN_USERNAME'),
  password: required('REDDIT_ADMIN_PASSWORD'),
  userAgent: `linux:com.kittycrow.maebot-reddit:repeat-flair-setup (by /u/${required('REDDIT_ADMIN_USERNAME')})`,
};

const reader = new RedditReadClient(admin);
const writer = new RedditMutationClient(admin);
const communities = ['catgirlcoin', 'nyaonearth'] as const;

for (const subreddit of communities) {
  const moderators = await reader.moderators(subreddit);
  const me = moderators.find(value => value.name.toLowerCase() === admin.username.toLowerCase()) ?? null;
  if (me === null) throw new Error(`u/${admin.username} is not a moderator of r/${subreddit}`);
  if (!me.permissions.includes('all') && !me.permissions.includes('config')) {
    throw new Error(`u/${admin.username} lacks config permission in r/${subreddit}`);
  }

  const flair = await ensureRepeatedQuestionFlair(subreddit, reader, writer);
  if (flair.text.trim().toLowerCase() !== REPEATED_QUESTION_FLAIR_TEXT.toLowerCase()) {
    throw new Error(`r/${subreddit} returned the wrong repeated-question flair`);
  }
  console.log(`r/${subreddit}: ${flair.id} -> ${flair.text}`);
}

console.log('Repeated-question flair provisioning complete.');
