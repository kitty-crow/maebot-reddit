import os
import sys
import praw
import prawcore
from redditbot import RedditBot
from commands import command_parser
from globals import min_comment_karma as mck, blacklisted_words, no_flair_notice, bot_notice, banned_css_classes, banned_from_posting
current = os.path.dirname(os.path.realpath(__file__))
parent_directory = os.path.dirname(current)
sys.path.append(f"{parent_directory}/common")
from logprint import custom_print
from database import database


# Initialising praw with login details for u/this_is_the_mae
reddit = praw.Reddit(
  client_id = 'GPs6wxXUncfEVH6wAn2KSQ',
  client_secret = os.environ['GPs6wxXUncfEVH6wAn2KSQ'],
  username = 'this_is_the_mae',
  password = os.environ['this_is_the_mae'],
  user_agent = "<ReplyCommentBot1.0>"
)

# definition of objects
bot = RedditBot("pairs.csv", reddit) # instance of the class RedditBot with file of responses
commands = command_parser(reddit)
subreddit = reddit.subreddit("catgirlcoin") # Instance of PRAW with info about the SR
db = database("database.db")
custom_print("Mae bot - Reddit logged in")
'''
flairs = subreddit.flair(limit=None)
users_with_u_flair = [flair['user'] for flair in flairs if flair['flair_css_class'] == 'u']
myList = {i: item.name for i, item in enumerate(users_with_u_flair)}
print(list(myList.values()))
#db["banned_users"] = list(myList.values())'''

for comment in subreddit.stream.comments(skip_existing=True):
  
  try:
    for user in db["warned_users"]:
      subreddit.flair.set(user, flair_template_id = 'bc2db8c4-29d5-11ed-a76f-163c4ee499e0')
    for user in db["banned_users"]:
      subreddit.flair.set(user, flair_template_id = 'e37b5534-91ce-11ec-84c8-7602fd74d2f2')
  except prawcore.exceptions.Forbidden as e:
    custom_print(str(e))

  author = comment.author
  blacklist_matches = [1 for i,x in enumerate(blacklisted_words) if blacklisted_words[i] in str(comment.body)]
  if sum(blacklist_matches) > 0:
    if (comment.author_flair_css_class == "h") or (not comment.author_flair_css_class):
      subreddit.flair.set(author.name, flair_template_id = 'bc2db8c4-29d5-11ed-a76f-163c4ee499e0')
      new_warned_users_list = db["warned_users"]
      new_warned_users_list.append(author.name)
      db["warned_users"] = new_warned_users_list
    elif comment.author_flair_css_class == "w":
      subreddit.flair.set(author.name, flair_template_id = 'e37b5534-91ce-11ec-84c8-7602fd74d2f2')
      new_warned_users_list = db["warned_users"]
      new_warned_users_list.remove(author.name)
      db["warned_users"] = new_warned_users_list
      new_banned_user_list = db["banned_users"]
      new_banned_user_list.append(author.name)
      db["banned_users"] = new_banned_user_list

    comment.mod.remove(mod_note = "Message removed due to blacklisted word/s used")
    custom_print(f"Comment removed in: https://reddit.com{comment.submission.permalink} due to blacklisted words")

  if (author == reddit.user.me()):
    pass
  if (comment.author_flair_css_class in banned_css_classes) or (author.name in db["banned_users"]):
    comment.mod.remove(mod_note = "Banned user")
    comment.reply(body = banned_from_posting + bot_notice.replace(" ", "&#x2005;"))
    custom_print(f"Comment removed in: https://reddit.com{comment.submission.permalink}")
  elif comment.author_flair_text == "":
    comment.mod.remove(mod_note = "User does not have a flair and therefore they can't comment")
    comment.reply(body = no_flair_notice + bot_notice.replace(" ", "&#x2005;"))
    custom_print(f"Comment removed in: https://reddit.com{comment.submission.permalink}")
  else:
    bot.find_match(comment)
  commands.check_commands(comment)