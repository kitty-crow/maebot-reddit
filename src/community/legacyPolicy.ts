export const legacyBlacklist = ['youtube.com', 'youtu.be', 'shitcoin', 'pump and dump', 'afelmuffin'] as const;
export const legacyBannedCss = new Set(['u', 's']);
export const legacyWarnedCss = 'w';

export type LegacyCommentSignals = {
  readonly blacklisted: boolean;
  readonly warned: boolean;
  readonly banned: boolean;
  readonly missingFlair: boolean;
};

export const legacyCommentSignals = (input: {
  readonly body: string;
  readonly flairCss: string | null;
  readonly flairText: string | null;
  readonly userInWarnedStore: boolean;
  readonly userInBannedStore: boolean;
}): LegacyCommentSignals => ({
  blacklisted: legacyBlacklist.some(term => input.body.includes(term)),
  warned: input.flairCss === legacyWarnedCss || input.userInWarnedStore,
  banned: (input.flairCss !== null && legacyBannedCss.has(input.flairCss)) || input.userInBannedStore,
  missingFlair: input.flairText === '',
});

export type LegacyPostSignals = {
  readonly missingFlair: boolean;
  readonly banned: boolean;
  readonly warned: boolean;
  readonly belowMinimumKarma: boolean;
  readonly warnedBelowMinimumKarma: boolean;
};

export const legacyPostSignals = (input: {
  readonly flairCss: string | null;
  readonly flairText: string | null;
  readonly linkKarma: number;
}): LegacyPostSignals => ({
  missingFlair: input.flairText === '',
  banned: input.flairCss !== null && legacyBannedCss.has(input.flairCss),
  warned: input.flairCss === legacyWarnedCss,
  belowMinimumKarma: input.linkKarma < 2,
  warnedBelowMinimumKarma: input.flairCss === legacyWarnedCss && input.linkKarma < 20,
});
