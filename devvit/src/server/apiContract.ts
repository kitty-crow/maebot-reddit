import { media, reddit } from '@devvit/web/server';

type RedditApi = typeof reddit;
type MediaApi = typeof media;

/**
 * Compile-time only capability contract for Devvit 0.14.4.
 *
 * This file deliberately performs no Reddit operations. If one of these
 * members disappears or changes incompatibly, TypeScript fails without
 * creating posts, changing moderation state, sending messages, or touching
 * any live subreddit.
 */
export type VerifiedDevvitSurface = Readonly<{
  getAppUser: RedditApi['getAppUser'];
  getSubredditInfoByName: RedditApi['getSubredditInfoByName'];
  getModerators: RedditApi['getModerators'];
  getBannedUsers: RedditApi['getBannedUsers'];
  getMutedUsers: RedditApi['getMutedUsers'];
  getUserFlairTemplates: RedditApi['getUserFlairTemplates'];
  getPostFlairTemplates: RedditApi['getPostFlairTemplates'];
  getRules: RedditApi['getRules'];
  getHotPosts: RedditApi['getHotPosts'];
  getNewPosts: RedditApi['getNewPosts'];
  getPostById: RedditApi['getPostById'];
  getCommentById: RedditApi['getCommentById'];
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
  muteUser: RedditApi['muteUser'];
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
  mediaUpload: MediaApi['upload'];
}>;
