import { existsSync } from 'node:fs';
import { expect, test } from 'bun:test';

const legacyRoot = 'deprecated/legacy-python';
const rootGlobals = await Bun.file(`${legacyRoot}/globals.py`).text();
const rootMain = await Bun.file(`${legacyRoot}/main.py`).text();
const legacySubmissionMain = await Bun.file(`${legacyRoot}/submission_moderation/main.py`).text();
const postGlobals = await Bun.file(`${legacyRoot}/submission_moderation/globals.py`).text();
const postModeration = await Bun.file(`${legacyRoot}/submission_moderation/post_moderation.py`).text();
const archiveReadme = await Bun.file(`${legacyRoot}/README.md`).text();

test('legacy Python implementation is physically separated from the active runtime', () => {
  for (const path of [
    'main.py',
    'redditbot.py',
    'commands.py',
    'globals.py',
    'counter.py',
    'haiku_finder.py',
    'leaderboard.py',
    'mods.py',
    'stringhandle.py',
    'syllable_fixes.py',
    'submission_moderation',
    'Pipfile',
    'Pipfile.lock',
    'poetry.lock',
    'pyproject.toml',
  ]) {
    expect(existsSync(path)).toBe(false);
  }

  expect(existsSync(`${legacyRoot}/main.py`)).toBe(true);
  expect(existsSync(`${legacyRoot}/submission_moderation/main.py`)).toBe(true);
  expect(existsSync(`${legacyRoot}/Pipfile`)).toBe(true);
  expect(existsSync(`${legacyRoot}/pyproject.toml`)).toBe(true);
});

test('deprecated archive documents that TypeScript and reputation.pb are authoritative', () => {
  expect(archiveReadme).toContain('Do not run this code');
  expect(archiveReadme).toContain('TypeScript/Bun implementation');
  expect(archiveReadme).toContain('data/reputation.pb');
  expect(archiveReadme).toContain('not authoritative');
  expect(archiveReadme).toContain('Active TypeScript code must not import from this directory');
});

test('legacy automated notices keep a blank paragraph before the markdown rule', () => {
  expect(rootGlobals).toContain('bot_notice = "\\n\\n---\\n^beep boop!');
  expect(postGlobals).toContain('bot_notice = "\\n\\n---\\n^beep boop!');
  expect(rootGlobals).not.toContain('bot_notice = "\\n---\\n^beep boop!');
  expect(postGlobals).not.toContain('bot_notice = "\\n---\\n^beep boop!');
});

test('legacy Reddit karma participation gates are retired', () => {
  for (const source of [rootGlobals, rootMain, legacySubmissionMain, postGlobals, postModeration]) {
    expect(source).not.toContain('min_comment_karma');
    expect(source).not.toContain('min_karma_post');
    expect(source).not.toContain('min_karma_removal');
    expect(source).not.toContain('restricted_from_posting');
    expect(source).not.toContain('comment_karma <');
    expect(source).not.toContain('link_karma <');
  }
});

test('legacy Python no longer auto-removes no-flair, warned or uncivil contributions', () => {
  expect(rootMain).not.toContain('comment.mod.remove');
  expect(rootMain).not.toContain('banned_css_classes');
  expect(rootMain).not.toContain('db["banned_users"]');
  expect(rootMain).toContain('if author == reddit.user.me():\n    continue');
  expect(postModeration).not.toContain('submission.mod.remove');
  expect(postModeration).not.toContain('banned_css_classes');
  expect(postModeration).not.toContain('no_flair_notice');
});

test('legacy submission-moderation launcher is inert and cannot fight reputation.pb', () => {
  expect(legacySubmissionMain).toContain('TypeScript reputation moderation is authoritative');
  expect(legacySubmissionMain).not.toContain('praw.Reddit');
  expect(legacySubmissionMain).not.toContain('subreddit.stream');
  expect(legacySubmissionMain).not.toContain('flair.set');
  expect(legacySubmissionMain).not.toContain('postMod(');
  expect(legacySubmissionMain).not.toContain('banned_users');
  expect(legacySubmissionMain).not.toContain('warned_users');
});
