export type RedditAccount = {
  readonly id: string;
  readonly name: string;
  readonly createdUtc: number | null;
  readonly linkKarma: number | null;
  readonly commentKarma: number | null;
};

export type RedditModerator = {
  readonly name: string;
  readonly id: string | null;
  readonly permissions: readonly string[];
};

export type RedditFlairTemplate = {
  readonly id: string;
  readonly text: string;
  readonly cssClass: string | null;
  readonly textColour: string | null;
  readonly backgroundColour: string | null;
  readonly modOnly: boolean;
  readonly textEditable: boolean;
  readonly allowableContent: string | null;
  readonly maxEmojis: number | null;
};

export type RedditFlairAssignment = {
  readonly username: string;
  readonly templateId: string | null;
  readonly text: string | null;
  readonly cssClass: string | null;
};

export type RedditRule = {
  readonly shortName: string;
  readonly description: string;
  readonly violationReason: string | null;
  readonly kind: string | null;
  readonly priority: number | null;
};

export type RedditSubreddit = {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly subscribers: number | null;
  readonly userIsModerator: boolean;
  readonly userFlairEnabled: boolean | null;
  readonly userFlairSelfAssign: boolean | null;
  readonly linkFlairEnabled: boolean | null;
  readonly over18: boolean | null;
  readonly submissionType: string | null;
};

export type RedditPost = {
  readonly id: string;
  readonly fullname: string;
  readonly subreddit: string;
  readonly title: string;
  readonly author: string | null;
  readonly permalink: string;
  readonly createdUtc: number;
  readonly selfText: string;
  readonly url: string;
  readonly flairTemplateId: string | null;
  readonly flairText: string | null;
  readonly stickied: boolean;
  readonly locked: boolean;
  readonly over18: boolean;
  readonly crosspostParent: string | null;
};

export type RedditComment = {
  readonly id: string;
  readonly fullname: string;
  readonly subreddit: string;
  readonly submissionFullname: string;
  readonly author: string | null;
  readonly body: string;
  readonly permalink: string;
  readonly createdUtc: number;
  readonly distinguished: string | null;
  readonly stickied: boolean;
  readonly removedByCategory: string | null;
};
