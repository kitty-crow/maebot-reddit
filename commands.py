import os
import sys
from mods import moderators
current = os.path.dirname(os.path.realpath(__file__))
parent_directory = os.path.dirname(current)
sys.path.append(f"{parent_directory}/common")
from database import database
from logprint import custom_print


class command_parser:
  def __init__(self, reddit):
    self.db = database("database.db")
    self.__BOT_NOTICE = "---\n^beep boop! I am a bot. This response is automated."
    self.__BEST_ANSWER = "Thanks for your question! Please be patient while one of our nyantastic community members replies. \n\n If someone answers your question, you can reply '!thankyou' and I will pin their answer on the top of the comments! (you must be OP) \n\n "
    self.__REDDIT_LINK = "https://reddit.com"
    self.reddit = reddit
    
  def __pinned_comment_creator(self, comment, submission):
    # exit conditions
    if (str(comment.author) != "this_is_the_mae"): # If the comment is not made by the bot
      return False
    if str(submission.id) in list(self.db.keys()): # If the current submission is already in the database
      return False
    if str(comment.body) != str(submission.id): # If the submission ID is not the comment
      return False
    # otherwise
    comment.mod.distinguish(sticky=True)  # Make the comment sticky and distinguish
    comment.edit(body = self.__BEST_ANSWER + self.__BOT_NOTICE.replace(" ", "&#x2005;")) # Add the notice of the bot
    questions_db = self.db["questions"]
    questions_db[str(submission.id)] = str(comment.id)
    self.db["questions"] = questions_db # Add submission to database
    return True

  def __delete_comment(self, comment):
    submission = self.reddit.submission(str(comment.link_id)[3:]) # Get submission of the current comment
    # building list of whitelisted users
    whitelist = list(moderators)
    whitelist.append(str(submission.author))
    # exit conditions
    if str(comment.body) != "!remove": # If the comment is not '!remove'
      return False
    if str(comment.author) not in whitelist: # If the comment is not made by OP or mod
      return False
    parentID = str(comment.parent_id)[3:]
    parent = self.reddit.comment(parentID)
    comment.mod.remove(mod_note = "Command removed by bot") # Remove command comment
    parent.mod.remove(mod_note = "Comment removed by bot") # Remove parent comment
    custom_print(f"Comment removed in: {self.__REDDIT_LINK}{submission.permalink}")
    return True

  def __pinned_comment_updater(self, comment, submission):
    # building list of whitelisted users
    whitelist = list(moderators)
    whitelist.append(str(submission.author))
    # exit conditions
    if str(comment.body) != "!thankyou": # If the comment is not '!thankyou'
      return False
    if str(comment.author) not in whitelist: # If the comment is not made by OP or mod
      comment.mod.remove(mod_note = "Command removed by bot") # Remove command comment
      return False
    if not str(submission.id) in list(self.db["questions"]): # If submission is not in the database
      comment.mod.remove(mod_note = "Command removed by bot") # Remove command comment
      return False
    # otherwise
    my_answer = self.reddit.comment(self.db["questions"][str(submission.id)]) # Get ID of the pinned answer (see line 24)
    the_answer = self.reddit.comment(str(comment.parent_id)[3:]) # Get the ID of the parent comment
    # Build reply:
    quote = str(the_answer.body).replace('\n', '\n >')
    the_reply = f"Best answer, by u/{str(the_answer.author)}: \n\n >{quote}"
    the_reply += f"\n\n [click here to jump to the original answer]({self.__REDDIT_LINK}{str(the_answer.permalink)})\n\n"
    the_reply += f"Is there a better answer? Just reply '!thankyou' to that answer and I will pin it! (you must be OP) \n\n"
    the_reply += self.__BOT_NOTICE.replace(" ", "&#x2005;")
    my_answer.edit(body = the_reply) # Post reply
    # Print in log
    custom_print(f"New best answer in: {self.__REDDIT_LINK}{submission.permalink}\n{self.__REDDIT_LINK}{str(my_answer.permalink)}") # Remove command comment
    comment.mod.remove(mod_note = "Command removed by bot") # Remove command comment
    return True

  def __find_best_answer(self, comment):
    submission = self.reddit.submission(str(comment.link_id)[3:]) # Get submission of the current comment
    # exit conditions
    if not "Question" in submission.link_flair_text: # If the flair of the submission is nit a Question
      return
    if self.__pinned_comment_creator(comment, submission): # If it is the best answer comment being created
      return
    if self.__pinned_comment_updater(comment, submission): # If it is the best answer comment being updated
      return
    return # If none of the conditions above are met (other comment)

  def check_commands(self, comment):
    self.__find_best_answer(comment)
    self.__delete_comment(comment)