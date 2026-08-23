import { expect, test } from 'bun:test';

const rootGlobals = await Bun.file('globals.py').text();
const rootMain = await Bun.file('main.py').text();
const legacySubmissionMain = await Bun.file('submission_moderation/main.py').text();
const postGlobals = await Bun.file('submission_moderation/globals.py').text();
const postModeration = await Bun.file('submission_moderation/post_moderation.py').text();

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
