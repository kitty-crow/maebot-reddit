import { describe, expect, test } from 'bun:test';
import { maeSupportRoute, violationNoticeText } from '../src/reputation/notices.ts';

describe('Mae reputation notices', () => {
  test('warned notices use Strikes and first-person constructive-review wording', () => {
    const text = violationNoticeText({
      state: 'warned',
      contentKind: 'comment',
      content: 'Needlessly hostile comment',
      reason: 'Personal hostility rather than constructive criticism.',
      points: -2,
    });
    expect(text).toContain('Current Strikes: 2/3');
    expect(text).toContain('reply to me');
    expect(text).toContain('I’ll reopen modmail immediately');
    expect(text).not.toMatch(/genuine apology|apologise|apologize/iu);
  });

  test('third strike remains warned and says the next loss can become uncivil', () => {
    const text = violationNoticeText({
      state: 'warned',
      contentKind: 'dm',
      content: 'Hostile DM',
      reason: 'Repeated hostility.',
      points: -3,
    });
    expect(text).toContain('3/3 Strikes');
    expect(text).toContain('Another reputation loss can mark your account as uncivil');
  });

  test('uncivil notices use Marks and explain comment-only participation', () => {
    const text = violationNoticeText({
      state: 'uncivil',
      contentKind: 'post',
      content: 'Removed post',
      reason: 'Rule violation.',
      points: -7,
    });
    expect(text).toContain('Current Marks: 7/10');
    expect(text).toContain('you can comment, but you cannot make posts');
    expect(text).toContain('At 10 Marks your account will be permanently banned');
    expect(text).toContain(maeSupportRoute);
  });
});
