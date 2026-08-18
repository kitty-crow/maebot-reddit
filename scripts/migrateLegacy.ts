import 'dotenv/config';
import { access, cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { importLegacyReddit } from '../src/migration/legacy.ts';

const cwd = process.cwd();
const commentDb = resolve(cwd, process.env['REDDIT_LEGACY_COMMENT_DB']?.trim() || 'database.db');
const submissionDb = resolve(cwd, process.env['REDDIT_LEGACY_SUBMISSION_DB']?.trim() || 'submission_moderation/database.db');
const stateFile = resolve(cwd, process.env['REDDIT_STATE_FILE']?.trim() || 'data/reddit.pb');
const snapshotBase = resolve(cwd, process.env['REDDIT_MIGRATION_SNAPSHOT_DIR']?.trim() || 'data/migration');
const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
const snapshot = resolve(snapshotBase, `legacy-reddit-${stamp}`);

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

await Promise.all([access(commentDb), access(submissionDb)]);
await mkdir(snapshot, { recursive: true });

const frozenComment = resolve(snapshot, 'comment-community.database.db');
const frozenSubmission = resolve(snapshot, 'submission-moderation.database.db');
await cp(commentDb, frozenComment, { preserveTimestamps: true });
await cp(submissionDb, frozenSubmission, { preserveTimestamps: true });

const pairs = resolve(cwd, 'pairs.csv');
if (await exists(pairs)) await cp(pairs, resolve(snapshot, 'pairs.csv'), { preserveTimestamps: true });
const haikus = resolve(cwd, 'Haikus');
if (await exists(haikus)) await cp(haikus, resolve(snapshot, 'Haikus'), { recursive: true, preserveTimestamps: true });

const [commentStat, submissionStat] = await Promise.all([
  stat(frozenComment),
  stat(frozenSubmission),
]);
const result = await importLegacyReddit({
  commentDb: frozenComment,
  submissionDb: frozenSubmission,
  stateFile,
});

const manifest = {
  schema: 1,
  createdAt: new Date().toISOString(),
  source: {
    commentDb,
    submissionDb,
  },
  frozen: {
    commentDb: {
      file: frozenComment,
      size: commentStat.size,
      mtimeMs: commentStat.mtimeMs,
      sha256: result.commentHash,
    },
    submissionDb: {
      file: frozenSubmission,
      size: submissionStat.size,
      mtimeMs: submissionStat.mtimeMs,
      sha256: result.submissionHash,
    },
    pairsCsv: await exists(resolve(snapshot, 'pairs.csv')),
    haikuArchive: await exists(resolve(snapshot, 'Haikus')),
  },
  import: result,
};
await writeFile(resolve(snapshot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

console.log(`Frozen legacy Reddit state at ${snapshot}`);
console.log(`comment/community sha256: ${result.commentHash}`);
console.log(`submission moderation sha256: ${result.submissionHash}`);
console.log(`warned=${result.warnedUsers} banned=${result.bannedUsers} questionMarkers=${result.questions} submissionQuestions=${result.submissionQuestions}`);
console.log(`titm=${result.titm} leaderboardUsers=${result.leaderboardUsers} haikuAuthors=${result.haikuAuthors}`);
console.log(result.alreadyImported ? 'Legacy snapshot was already imported byte-for-byte.' : 'Legacy snapshot imported into Reddit protobuf state.');
