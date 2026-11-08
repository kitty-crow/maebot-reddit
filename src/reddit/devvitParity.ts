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
    "subreddit": "staged",
    "moderators": "staged",
    "bannedUsers": "staged",
    "bannedUser": "staged",
    "mutedUsers": "staged",
    "mutedUser": "staged",
    "emojis": "not-started",
    "userFlairTemplates": "partial",
    "postFlairTemplates": "partial",
    "userFlairAssignments": "partial",
    "userFlairAssignment": "partial",
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
    "modmailConversations": "partial",
    "modmailConversation": "partial",
    "scores": "partial"
  },
  "mutation": {
    "rate": "local",
    "submitSelf": "blocked",
    "crosspost": "blocked",
    "createFlairTemplate": "partial",
    "uploadEmoji": "not-started",
    "updateEmojiPermissions": "not-started",
    "setUserFlairTemplate": "partial",
    "userFlairSelection": "not-started",
    "setUserFlairDirect": "partial",
    "setPostFlairTemplate": "partial",
    "remove": "partial",
    "banUser": "partial",
    "unbanUser": "partial",
    "sendPrivateMessage": "blocked",
    "replyToPrivateMessage": "blocked",
    "markPrivateMessageRead": "not-started",
    "replyModmail": "partial",
    "archiveModmail": "partial",
    "muteModmail": "partial",
    "unmuteModmail": "partial",
    "muteUser": "blocked",
    "unmuteUser": "partial",
    "sticky": "not-started"
  },
  "media": {
    "uploadMedia": "not-started",
    "submitMedia": "blocked",
    "submitGallery": "blocked"
  },
  "modNotes": {
    "recentCommentsInCommunities": "partial",
    "addModNote": "partial",
    "deleteModNote": "partial"
  },
  "publisher": {
    "publishPrimary": "blocked",
    "publishLegacy": "blocked",
    "pin": "not-started"
  }
} as const satisfies Readonly<Record<keyof typeof paritySources, Readonly<Record<string, ParityState>>>>;

// Nothing in this ledger is verified for production cutover.
// A migration is complete only after every operation has a production-parity test.
