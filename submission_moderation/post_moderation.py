import os
import sys
from question_cleaner import question_cleaner
from similar_questions import find_similarity
from globals import min_karma_post as mkp, min_karma_removal as mkComment, bot_notice, no_flair_notice, banned_css_classes, banned_from_posting, restricted_css_classes, restricted_from_posting
current = os.path.dirname(os.path.realpath(__file__))
parent_directory = os.path.split(os.path.dirname(current))[0]
sys.path.append(f"{parent_directory}/common")
from logprint import custom_print
from database import database


db = database("database.db")

def postMod(submission):
  author = submission.author
  if author in ("catgirl_rie", "catgirlcoin"):
    return
  the_reply = ""
  if not submission.author_flair_text:
    the_reply = no_flair_notice + bot_notice.replace(" ", "&#x2005;")
  elif submission.author_flair_css_class in banned_css_classes:
    the_reply = banned_from_posting + bot_notice.replace(" ", "&#x2005;")
  elif (submission.author_flair_css_class in restricted_css_classes) and (author.link_karma < mkp * 10):
    the_reply = restricted_from_posting + bot_notice.replace(" ", "&#x2005;")
  elif author.link_karma < mkp:
      the_reply = mkComment + bot_notice.replace(" ", "&#x2005;")
  if the_reply:
    comment = submission.reply(body=the_reply)
    comment.mod.distinguish(sticky=True)
    submission.mod.remove()
    custom_print(f"Submission removed: https://reddit.com{submission.permalink}")
    return False
  if "Question" in submission.link_flair_text:
    return question_post(submission)
  return True
  
def question_post(submission):
  submission_id = str(submission.id)

  # PRAW may replay an old submission after reconnecting. Do not process it
  # again or post another marker if it is already in the database.
  if submission_id in {str(question_id) for question_id in db.keys()}:
    custom_print(
      f"Question already in database, skipping replay: "
      f"https://reddit.com{submission.permalink}"
    )
    return False

  if not question_cleaner(submission):  # Ensures that the submission follows the question standard.
    return False
  if not find_similarity(submission):  # Finds the similarity between the latest submission and previous questions
    return False
  custom_print(str(submission.title)) # If the question is not too similar to previous ones, add it to the log
  db[submission_id] = submission.title  # Add question to the database
  submission.reply(body = submission_id)  # Reply with the submission ID to handle with best_answer.py
  return True
