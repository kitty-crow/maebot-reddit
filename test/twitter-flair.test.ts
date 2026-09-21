import { describe, expect, test } from 'bun:test';
import {
  MAJOR_ANNOUNCEMENT_FLAIR,
  MINOR_ANNOUNCEMENT_FLAIR,
  twitterAnnouncementFlair,
} from '../src/twitter/flair.ts';

describe('Twitter Reddit announcement flair policy', () => {
  test('maps Daily Task-worthy tweets to the major announcement flair', () => {
    expect(twitterAnnouncementFlair(true)).toBe(MAJOR_ANNOUNCEMENT_FLAIR);
    expect(MAJOR_ANNOUNCEMENT_FLAIR).toBe('Announcement :catgirl-moon:');
  });

  test('maps ordinary tweets to the minor announcement flair', () => {
    expect(twitterAnnouncementFlair(false)).toBe(MINOR_ANNOUNCEMENT_FLAIR);
    expect(MINOR_ANNOUNCEMENT_FLAIR).toBe('Minor Announcement :lisa:');
  });

  test('refuses to guess a flair before classification is complete', () => {
    expect(() => twitterAnnouncementFlair(null)).toThrow('completed Daily Task classification');
  });
});
