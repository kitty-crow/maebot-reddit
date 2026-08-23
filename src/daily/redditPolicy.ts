import { MINOR_ANNOUNCEMENT_FLAIR } from '../twitter/flair.ts';

export const WEEKLY_SUMMARY_FLAIR = MINOR_ANNOUNCEMENT_FLAIR;
export const WEEKLY_HIGHLIGHT_LABEL = 'Announcement';
export const WEEKLY_HIGHLIGHT_REMOVE_AFTER = 'this-week';

const weekSeconds = 7 * 24 * 60 * 60;

export const weeklyHighlightExpiresAt = (weekStart: string): number => {
  const start = Date.parse(`${weekStart}T00:00:00Z`);
  if (!Number.isFinite(start)) throw new Error(`Invalid weekly Daily Task start date: ${weekStart}`);
  return Math.floor(start / 1_000) + weekSeconds;
};
