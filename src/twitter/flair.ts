export const MAJOR_ANNOUNCEMENT_FLAIR = 'Announcement :catgirl-moon:';
export const MINOR_ANNOUNCEMENT_FLAIR = 'Minor Announcement :lisa:';

export const twitterAnnouncementFlair = (worthy: boolean | null): string => {
  if (worthy === null) throw new Error('Twitter Reddit flair requires a completed Daily Task classification');
  return worthy ? MAJOR_ANNOUNCEMENT_FLAIR : MINOR_ANNOUNCEMENT_FLAIR;
};
