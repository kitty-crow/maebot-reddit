import 'dotenv/config';
import { promptSecret, promptText } from '../src/cli/securePrompt.ts';
import { emojiClonePreflight } from '../src/emoji/preflight.ts';
import { redditConfig } from '../src/env.ts';
import { RedditReadClient } from '../src/reddit/client.ts';
import { redditEmojiAdminAuth } from '../src/reddit/emojiAdminAuth.ts';
import { safeError } from '../src/reddit/error.ts';

const sourceSubreddit = 'catgirlcoin';
const targetSubreddit = 'nyaonearth';

const yesNo = (value: boolean): string => value ? 'YES' : 'NO';

try {
  const cfg = redditConfig();

  console.log('Reddit custom emoji clone pre-flight');
  console.log('READ ONLY: this command does not create, update or delete Reddit emoji state.');
  console.log('Credentials are held only in memory for this process and are never persisted.');
  console.log();

  const username = await promptText('Reddit username: ');
  const password = await promptSecret('Reddit password (hidden): ');
  const auth = redditEmojiAdminAuth(cfg.auth, { username, password });
  const read = new RedditReadClient(auth);

  console.log();
  console.log('Authenticating and checking both communities...');

  const result = await emojiClonePreflight(read, [
    { subreddit: sourceSubreddit, requireManageSettings: false },
    { subreddit: targetSubreddit, requireManageSettings: true },
  ]);

  console.log(`Authenticated as: u/${result.accountName}`);
  console.log();

  for (const community of result.communities) {
    console.log(`r/${community.subreddit}`);
    console.log(`  moderator:                   ${yesNo(community.moderator)}`);
    console.log(
      `  Manage Settings (config):    ${yesNo(community.manageSettings)}`
      + `${community.manageSettingsRequired ? ' [REQUIRED]' : ' [not required for source read]'}`,
    );
    console.log(`  custom emoji inventory read: ${yesNo(community.emojiInventoryReadable)}`);
    console.log(`  custom emojis visible:       ${community.emojiCount ?? '(unavailable)'}`);
    console.log(
      `  granted moderator perms:     ${community.grantedPermissions.length > 0
        ? community.grantedPermissions.join(', ')
        : '(none)'}`,
    );
    for (const failure of community.failures) console.log(`  FAIL: ${failure}`);
    console.log(`  community result:            ${community.passed ? 'PASS' : 'FAIL'}`);
    console.log();
  }

  if (!result.passed) {
    console.error('EMOJI CLONE PRE-FLIGHT: FAIL');
    process.exitCode = 1;
  } else {
    console.log('EMOJI CLONE PRE-FLIGHT: PASS');
    console.log(`u/${result.accountName} can perform the planned CatgirlCoin -> NyaOnEarth emoji clone.`);
  }
} catch (error) {
  console.error(`EMOJI CLONE PRE-FLIGHT: FAIL — ${safeError(error)}`);
  process.exitCode = 1;
}
