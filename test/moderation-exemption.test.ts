import { expect, test } from 'bun:test';
import { moderationExemption, moderatorSet } from '../src/mod/exemption.ts';

test('Mae herself is excluded from AI moderation case-insensitively', () => {
  const moderators = moderatorSet(['humanMod']);
  expect(moderationExemption('this_is_the_mae', 'this_is_the_mae', moderators)).toBe('bot');
  expect(moderationExemption('THIS_IS_THE_MAE', 'this_is_the_mae', moderators)).toBe('bot');
});

test('live moderators are excluded from AI moderation case-insensitively', () => {
  const moderators = moderatorSet(['HumanMod', 'OtherMod']);
  expect(moderationExemption('humanmod', 'this_is_the_mae', moderators)).toBe('moderator');
  expect(moderationExemption('OtherMod', 'this_is_the_mae', moderators)).toBe('moderator');
});

test('ordinary and deleted authors are not misclassified as privileged', () => {
  const moderators = moderatorSet(['HumanMod']);
  expect(moderationExemption('ordinaryUser', 'this_is_the_mae', moderators)).toBeNull();
  expect(moderationExemption(null, 'this_is_the_mae', moderators)).toBeNull();
});
