import { reddit } from '@devvit/web/server';

type RedditApi = typeof reddit;
type PostModel = Awaited<ReturnType<RedditApi['getPostById']>>;

/**
 * Compile-time-only capability contract for Devvit 0.14.4.
 *
 * Nothing in this file is imported by the runtime entrypoint. Its purpose is to
 * make TypeScript reject a compatibility mapping when a Devvit method or the
 * exact argument shape we rely on disappears or changes.
 */
export type VerifiedDevvitSurface = Readonly<{
  getAppUser: RedditApi['getAppUser'];
  getSubredditInfoByName: RedditApi['getSubredditInfoByName'];
  getModerators: RedditApi['getModerators'];
  getBannedUsers: RedditApi['getBannedUsers'];
  getMutedUsers: RedditApi['getMutedUsers'];
  getRules: RedditApi['getRules'];
  getHotPosts: RedditApi['getHotPosts'];
  getNewPosts: RedditApi['getNewPosts'];
  getPostById: RedditApi['getPostById'];
  submitPost: RedditApi['submitPost'];
  crosspost: RedditApi['crosspost'];
  createUserFlairTemplate: RedditApi['createUserFlairTemplate'];
  createPostFlairTemplate: RedditApi['createPostFlairTemplate'];
  setUserFlair: RedditApi['setUserFlair'];
  setPostFlair: RedditApi['setPostFlair'];
  remove: RedditApi['remove'];
  banUser: RedditApi['banUser'];
  unbanUser: RedditApi['unbanUser'];
  sendPrivateMessage: RedditApi['sendPrivateMessage'];
  unmuteUser: RedditApi['unmuteUser'];
  addModNote: RedditApi['addModNote'];
  deleteModNote: RedditApi['deleteModNote'];
  modMail: Readonly<{
    getConversations: RedditApi['modMail']['getConversations'];
    getConversation: RedditApi['modMail']['getConversation'];
    reply: RedditApi['modMail']['reply'];
    archiveConversation: RedditApi['modMail']['archiveConversation'];
    muteConversation: RedditApi['modMail']['muteConversation'];
    unmuteConversation: RedditApi['modMail']['unmuteConversation'];
  }>;
}>;

const subredditListing = {
  subredditName: 'catgirlcoin',
  limit: 100,
  pageSize: 100,
} satisfies Parameters<RedditApi['getModerators']>[0];

const relationshipListing = {
  subredditName: 'catgirlcoin',
  limit: 100,
  pageSize: 100,
} satisfies Parameters<RedditApi['getBannedUsers']>[0];

const postListing = {
  subredditName: 'catgirlcoin',
  limit: 25,
  pageSize: 25,
} satisfies Parameters<RedditApi['getNewPosts']>[0];

const selfPost = {
  subredditName: 'catgirlcoin',
  title: 'title',
  text: 'body',
  sendreplies: true,
  runAs: 'APP',
  flairId: 'flair-id',
} satisfies Parameters<RedditApi['submitPost']>[0];

const crosspost = {
  subredditName: 'catgirlcoin',
  postId: 't3_source',
  title: 'title',
  sendreplies: true,
  runAs: 'APP',
  flairId: 'flair-id',
} satisfies Parameters<RedditApi['crosspost']>[0];

const flairTemplate = {
  subredditName: 'catgirlcoin',
  text: 'Pawsome',
  allowableContent: 'all',
  backgroundColor: '#ffffff',
  maxEmojis: 2,
  modOnly: false,
  textColor: 'dark',
  allowUserEdits: false,
} satisfies Parameters<RedditApi['createUserFlairTemplate']>[0];

const userFlair = {
  subredditName: 'catgirlcoin',
  username: 'Member',
  flairTemplateId: 'flair-id',
  text: 'Custom',
} satisfies Parameters<RedditApi['setUserFlair']>[0];

const postFlair = {
  subredditName: 'catgirlcoin',
  postId: 't3_post',
  flairTemplateId: 'flair-id',
  text: 'Custom',
} satisfies Parameters<RedditApi['setPostFlair']>[0];

const ban = {
  subredditName: 'catgirlcoin',
  username: 'BadUser',
  reason: 'reason',
  note: 'note',
  duration: 7,
} satisfies Parameters<RedditApi['banUser']>[0];


const privateMessage = {
  to: 'Member',
  subject: 'Hello',
  text: 'Body',
} satisfies Parameters<RedditApi['sendPrivateMessage']>[0];

const modNote = {
  subreddit: 'catgirlcoin',
  user: 'Member',
  note: 'note',
  redditId: 't1_comment',
} satisfies Parameters<RedditApi['addModNote']>[0];

const deleteModNote = {
  subreddit: 'catgirlcoin',
  user: 'Member',
  noteId: 'ModNote_abc',
} satisfies Parameters<RedditApi['deleteModNote']>[0];

const modmailPage = {
  subreddits: ['catgirlcoin'],
  limit: 25,
  sort: 'recent',
  state: 'all',
} satisfies Parameters<RedditApi['modMail']['getConversations']>[0];

const modmailSingle = {
  conversationId: 'abcdef',
  markRead: false,
} satisfies Parameters<RedditApi['modMail']['getConversation']>[0];

const modmailReply = {
  conversationId: 'abcdef',
  body: 'reply',
  isAuthorHidden: false,
  isInternal: false,
} satisfies Parameters<RedditApi['modMail']['reply']>[0];

const modmailMute = {
  conversationId: 'abcdef',
  numHours: 72,
} satisfies Parameters<RedditApi['modMail']['muteConversation']>[0];

const sticky = [2] satisfies Parameters<PostModel['sticky']>;

/**
 * Exported only so noUnusedLocals keeps every compile-time witness alive.
 * The object is never imported by the Devvit runtime bundle.
 */
export const devvitCallContracts = {
  subredditInfo: ['catgirlcoin'] satisfies Parameters<RedditApi['getSubredditInfoByName']>,
  moderators: [subredditListing] satisfies Parameters<RedditApi['getModerators']>,
  banned: [relationshipListing] satisfies Parameters<RedditApi['getBannedUsers']>,
  muted: [relationshipListing] satisfies Parameters<RedditApi['getMutedUsers']>,
  rules: ['catgirlcoin'] satisfies Parameters<RedditApi['getRules']>,
  hot: [postListing] satisfies Parameters<RedditApi['getHotPosts']>,
  new: [postListing] satisfies Parameters<RedditApi['getNewPosts']>,
  postById: ['t3_post'] satisfies Parameters<RedditApi['getPostById']>,
  submitPost: [selfPost] satisfies Parameters<RedditApi['submitPost']>,
  crosspost: [crosspost] satisfies Parameters<RedditApi['crosspost']>,
  createUserFlairTemplate: [flairTemplate] satisfies Parameters<RedditApi['createUserFlairTemplate']>,
  createPostFlairTemplate: [flairTemplate] satisfies Parameters<RedditApi['createPostFlairTemplate']>,
  setUserFlair: [userFlair] satisfies Parameters<RedditApi['setUserFlair']>,
  setPostFlair: [postFlair] satisfies Parameters<RedditApi['setPostFlair']>,
  remove: ['t1_comment', false] satisfies Parameters<RedditApi['remove']>,
  banUser: [ban] satisfies Parameters<RedditApi['banUser']>,
  unbanUser: ['BadUser', 'catgirlcoin'] satisfies Parameters<RedditApi['unbanUser']>,
  unmuteUser: ['NoisyUser', 'catgirlcoin'] satisfies Parameters<RedditApi['unmuteUser']>,
  sendPrivateMessage: [privateMessage] satisfies Parameters<RedditApi['sendPrivateMessage']>,
  addModNote: [modNote] satisfies Parameters<RedditApi['addModNote']>,
  deleteModNote: [deleteModNote] satisfies Parameters<RedditApi['deleteModNote']>,
  modmailPage: [modmailPage] satisfies Parameters<RedditApi['modMail']['getConversations']>,
  modmailSingle: [modmailSingle] satisfies Parameters<RedditApi['modMail']['getConversation']>,
  modmailReply: [modmailReply] satisfies Parameters<RedditApi['modMail']['reply']>,
  modmailArchive: ['abcdef'] satisfies Parameters<RedditApi['modMail']['archiveConversation']>,
  modmailMute: [modmailMute] satisfies Parameters<RedditApi['modMail']['muteConversation']>,
  modmailUnmute: ['abcdef'] satisfies Parameters<RedditApi['modMail']['unmuteConversation']>,
  sticky,
};
