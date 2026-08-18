import 'dotenv/config';
import { redditConfig } from '../src/env.ts';
import { FlairCloner } from '../src/flair/clone.ts';
import { RedditReadClient } from '../src/reddit/client.ts';
import { RedditMutationClient } from '../src/reddit/mutate.ts';

const cfg = redditConfig();
if (cfg.sourceSubreddit.toLowerCase() === cfg.primarySubreddit.toLowerCase()) {
  throw new Error('Source and primary subreddit must be different for flair migration');
}

const read = new RedditReadClient(cfg.auth);
const write = new RedditMutationClient(cfg.auth);
const [me, source, target] = await Promise.all([
  read.me(),
  read.subreddit(cfg.sourceSubreddit),
  read.subreddit(cfg.primarySubreddit),
]);
if (!source.userIsModerator) throw new Error(`${me.name} is not a moderator of r/${cfg.sourceSubreddit}`);
if (!target.userIsModerator) throw new Error(`${me.name} is not a moderator of r/${cfg.primarySubreddit}`);

console.log(`Cloning user and post flairs: r/${cfg.sourceSubreddit} -> r/${cfg.primarySubreddit}`);
const result = await new FlairCloner(read, write).clone(cfg.sourceSubreddit, cfg.primarySubreddit);
console.log(`user templates created=${result.userTemplatesCreated}`);
console.log(`post templates created=${result.postTemplatesCreated}`);
console.log(`user assignments applied=${result.userAssignmentsApplied}`);
console.log(`user assignments already correct=${result.userAssignmentsAlreadyCorrect}`);
console.log('Flair clone complete.');
