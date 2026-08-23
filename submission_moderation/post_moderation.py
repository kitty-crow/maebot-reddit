import os
import sys
from question_cleaner import question_cleaner
from similar_questions import find_similarity
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

  # Legacy no-flair and uncivil auto-removal is intentionally retired. The
  # TypeScript LLM + reputation runtime is the sole moderation authority and
  # warned/uncivil users retain a redemption path through audited activity.
  if submission.link_flair_text and "Question" in submission.link_flair_text:
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

  if not question_cleaner(submission):
    return False
  if not find_similarity(submission):
    return False
  custom_print(str(submission.title))
  db[submission_id] = submission.title
  submission.reply(body = submission_id)
  return True
