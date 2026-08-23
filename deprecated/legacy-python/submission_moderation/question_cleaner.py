import os
import sys
import re
from globals import q_regex, notaquestion, bot_notice
current = os.path.dirname(os.path.realpath(__file__))
parent_directory = os.path.split(os.path.dirname(current))[0]
sys.path.append(f"{parent_directory}/common")
from logprint import custom_print

# Determines if the title of a submission is a question with the use of Regex
def question_cleaner(submission):
  if not re.search(q_regex, submission.title.lower()): # If standard not followed
    submission.mod.flair(flair_template_id = "1665cd56-3b73-11ec-a087-0ea29f318ec4", css_class="bot") # Change flair
    answer = notaquestion + bot_notice.replace(" ", "&#x2005;") # Build reply string
    comment = submission.reply(body = answer) # Post reply string
    comment.mod.distinguish(sticky=False) # Distinguish as Mod
    custom_print(f"Incorrect use of question flair found: https://reddit.com{submission.permalink}") # Add to log
    return False # Return False
  return True # If standard followed, return True
