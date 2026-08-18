import { expect, test } from 'bun:test';
import { twitterAnnouncementFlair } from '../src/twitter/flair.ts';

test('Twitter flair labels remain exact deployment semantics', () => {
  expect(twitterAnnouncementFlair(true)).toBe('Announcement :catgirl-moon:');
  expect(twitterAnnouncementFlair(false)).toBe('Minor Announcement :lisa:');
});
