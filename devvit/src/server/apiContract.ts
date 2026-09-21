import { media, reddit } from '@devvit/web/server';

export const assertDevvitRedditApiContract = async (): Promise<void> => {
  void await reddit.getAppUser();
  void await reddit.getSubredditInfoByName('catgirlcoin');
  void await reddit.getUserFlairTemplates('catgirlcoin');
  void await reddit.getPostFlairTemplates('catgirlcoin');
  void await reddit.getPostById('t3_example');
  void await reddit.getCommentById('t1_example');

  void await reddit.getModerators({
    subredditName: 'catgirlcoin',
    limit: 1,
    pageSize: 1,
  }).all();
  void await reddit.getBannedUsers({
    subredditName: 'catgirlcoin',
    limit: 1,
    pageSize: 1,
  }).all();
  void await reddit.getMutedUsers({
    subredditName: 'catgirlcoin',
    limit: 1,
    pageSize: 1,
  }).all();
  void await reddit.getNewPosts({
    subredditName: 'catgirlcoin',
    limit: 1,
    pageSize: 1,
  }).all();
  void await reddit.getHotPosts({
    subredditName: 'catgirlcoin',
    limit: 1,
    pageSize: 1,
  }).all();
  const messages = await reddit.getMessages({
    type: 'inbox',
    limit: 1,
    pageSize: 1,
  });
  const privateMessages = await messages.all();
  const firstMessage = privateMessages[0];
  if (firstMessage !== undefined) void await firstMessage.markAsRead();

  void await reddit.submitPost({
    subredditName: 'catgirlcoin',
    title: 'contract',
    text: 'contract',
    sendreplies: true,
    runAs: 'APP',
  });
  void await reddit.submitPost({
    subredditName: 'catgirlcoin',
    title: 'contract',
    kind: 'image',
    imageUrls: ['https://i.redd.it/contract.png'],
    sendreplies: true,
    runAs: 'APP',
  });
  void await reddit.crosspost({
    subredditName: 'nyaonearth',
    postId: 't3_example',
    title: 'contract',
    sendreplies: true,
    runAs: 'APP',
  });

  void await reddit.createUserFlairTemplate({
    subredditName: 'catgirlcoin',
    text: 'contract',
  });
  void await reddit.createPostFlairTemplate({
    subredditName: 'catgirlcoin',
    text: 'contract',
  });
  void await reddit.setUserFlair({
    subredditName: 'catgirlcoin',
    username: 'example',
    flairTemplateId: 'template',
  });
  void await reddit.setPostFlair({
    subredditName: 'catgirlcoin',
    postId: 't3_example',
    flairTemplateId: 'template',
  });

  void await reddit.remove('t3_example', false);
  void await reddit.banUser({
    subredditName: 'catgirlcoin',
    username: 'example',
    reason: 'contract',
    note: 'contract',
  });
  void await reddit.unbanUser('example', 'catgirlcoin');
  void await reddit.muteUser({
    subredditName: 'catgirlcoin',
    username: 'example',
    note: 'contract',
  });
  void await reddit.unmuteUser('example', 'catgirlcoin');

  void await reddit.sendPrivateMessage({
    to: 'example',
    subject: 'contract',
    text: 'contract',
  });

  void await reddit.addModNote({
    subreddit: 'catgirlcoin',
    user: 'example',
    note: 'contract',
    redditId: 't1_example',
  });
  void await reddit.deleteModNote({
    subreddit: 'catgirlcoin',
    user: 'example',
    noteId: 'ModNote_example',
  });

  void await reddit.modMail.getConversations({
    subreddits: ['catgirlcoin'],
    limit: 1,
    state: 'all',
  });
  void await reddit.modMail.getConversation({
    conversationId: 'example',
    markRead: false,
  });
  void await reddit.modMail.reply({
    conversationId: 'example',
    body: 'contract',
  });
  void await reddit.modMail.archiveConversation('example');
  void await reddit.modMail.muteConversation({
    conversationId: 'example',
    numHours: 72,
  });
  void await reddit.modMail.unmuteConversation('example');

  const post = await reddit.getPostById('t3_example');
  void await post.sticky(1);

  void await media.upload({
    url: 'data:image/png;base64,iVBORw0KGgo=',
    type: 'image',
  });
};
