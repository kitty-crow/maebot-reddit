// This is an acceptance ledger, not an activation switch.
// Staged means unit-tested preview only; it does not imply a live install passed.
export type ParityState = 'local' | 'staged' | 'partial' | 'blocked' | 'not-started';

export const paritySources = {
  "read": {
    "path": "src/reddit/client.ts",
    "className": "RedditReadClient"
  },
  "mutation": {
    "path": "src/reddit/mutate.ts",
    "className": "RedditMutationClient"
  },
  "media": {
    "path": "src/reddit/media.ts",
    "className": "RedditMediaClient"
  },
  "modNotes": {
    "path": "src/modnotes/reddit.ts",
    "className": "MemberModNotesRedditClient"
  },
  "publisher": {
    "path": "src/twitter/publisher.ts",
    "className": "LiveTwitterRedditPublisher"
  }
} as const;

export const devvitParity = {
  "read": {
    "rate": "local",
    "me": "blocked",
    "subreddit": "not-started",
    "moderators": "staged",
    "bannedUsers": "staged",
    "bannedUser": "not-started",
    "mutedUsers": "staged",
    "mutedUser": "not-started",
    "emojis": "not-started",
    "userFlairTemplates": "not-started",
    "postFlairTemplates": "not-started",
    "userFlairAssignments": "not-started",
    "userFlairAssignment": "not-started",
    "rules": "partial",
    "sticky": "not-started",
    "hotPosts": "staged",
    "newPosts": "staged",
    "newComments": "blocked",
    "newPostsHistory": "partial",
    "newCommentsHistory": "blocked",
    "inboxDirectMessages": "not-started",
    "unreadDirectMessages": "not-started",
    "sentDirectMessages": "not-started",
    "modmailConversations": "not-started",
    "modmailConversation": "not-started",
    "scores": "not-started"
  },
  "mutation": {
    "rate": "local",
    "submitSelf": "blocked",
    "crosspost": "blocked",
    "createFlairTemplate": "not-started",
    "uploadEmoji": "not-started",
    "updateEmojiPermissions": "not-started",
    "setUserFlairTemplate": "not-started",
    "userFlairSelection": "not-started",
    "setUserFlairDirect": "not-started",
    "setPostFlairTemplate": "not-started",
    "remove": "not-started",
    "banUser": "not-started",
    "unbanUser": "not-started",
    "sendPrivateMessage": "blocked",
    "replyToPrivateMessage": "blocked",
    "markPrivateMessageRead": "not-started",
    "replyModmail": "not-started",
    "archiveModmail": "not-started",
    "muteModmail": "not-started",
    "unmuteModmail": "not-started",
    "muteUser": "not-started",
    "unmuteUser": "not-started",
    "sticky": "not-started"
  },
  "media": {
    "uploadMedia": "not-started",
    "submitMedia": "blocked",
    "submitGallery": "blocked"
  },
  "modNotes": {
    "recentCommentsInCommunities": "blocked",
    "addModNote": "not-started",
    "deleteModNote": "not-started"
  },
  "publisher": {
    "publishPrimary": "blocked",
    "publishLegacy": "blocked",
    "pin": "not-started"
  }
} as const satisfies Readonly<Record<keyof typeof paritySources, Readonly<Record<string, ParityState>>>>;

// Nothing in this ledger is verified for production cutover.
// A migration is complete only after every operation has a production-parity test.
