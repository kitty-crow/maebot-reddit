import os
import sys
import praw
import prawcore
from post_moderation import postMod
from database_reduild import delete_question_database, update_question_database
current = os.path.dirname(os.path.realpath(__file__))
parent_directory = os.path.split(os.path.dirname(current))[0]
sys.path.append(f"{parent_directory}/common")
from logprint import custom_print
from database import database

reddit_dir = os.path.abspath(os.path.join(os.getcwd(), '..'))
parent_db_dir = os.path.join(reddit_dir, 'database.db')

# initialising reddit bot
reddit = praw.Reddit(
  client_id = 'GPs6wxXUncfEVH6wAn2KSQ',
  client_secret = os.environ['GPs6wxXUncfEVH6wAn2KSQ'],
  username = 'this_is_the_mae',
  password = os.environ['this_is_the_mae'],
  user_agent = "<ReplyCommentBot1.0>"
)
# defining subreddit
subreddit = reddit.subreddit("catgirlcoin")
# set the below boolean to True to remove all questions from the database and rebuild it
startover = False
parentdb = database(parent_db_dir)
custom_print("Mae bot - Reddit (Submission Moderation) logged in")

moderator_usernames = tuple(str(mod) for mod in subreddit.moderator())
print(f"Moderators: {', '.join(moderator_usernames)}")

if startover:  # Used when rebuilding the database
  delete_question_database()
for submission in subreddit.stream.submissions(skip_existing = not startover):  # Submission stream to search for questions

  try:
    for user in parentdb["warned_users"]:
      subreddit.flair.set(user, flair_template_id = 'bc2db8c4-29d5-11ed-a76f-163c4ee499e0')
    for user in parentdb["banned_users"]:
      subreddit.flair.set(user, flair_template_id = 'e37b5534-91ce-11ec-84c8-7602fd74d2f2')
  except prawcore.exceptions.Forbidden as e:
    pass

  if submission.author not in moderator_usernames:
    (postMod(submission) if not startover else update_question_database(submission))
  else:
    custom_print(f"Post made by moderator: {submission.author}.")
