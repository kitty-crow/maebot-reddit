import os
import sys
import praw
from redditbot import RedditBot
from commands import command_parser
current = os.path.dirname(os.path.realpath(__file__))
parent_directory = os.path.dirname(current)
sys.path.append(f"{parent_directory}/common")
from logprint import custom_print


# Initialising praw with login details for u/this_is_the_mae
reddit = praw.Reddit(
  client_id = 'GPs6wxXUncfEVH6wAn2KSQ',
  client_secret = os.environ['GPs6wxXUncfEVH6wAn2KSQ'],
  username = 'this_is_the_mae',
  password = os.environ['this_is_the_mae'],
  user_agent = "<ReplyCommentBot1.0>"
)

# Legacy community replies/commands remain available for compatibility, but
# moderation authority has moved to the TypeScript LLM + reputation runtime.
# This process must not enforce old no-flair, warned/uncivil, blacklist, karma,
# or legacy database restrictions if it is ever started during the cutover.
bot = RedditBot("pairs.csv", reddit)
commands = command_parser(reddit)
subreddit = reddit.subreddit("catgirlcoin")
custom_print("Mae bot - Reddit logged in (legacy moderation disabled)")

for comment in subreddit.stream.comments(skip_existing=True):
  author = comment.author
  if author == reddit.user.me():
    continue
  bot.find_match(comment)
  commands.check_commands(comment)
