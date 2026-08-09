import praw
import os
import sys
import csv
from datetime import datetime
from haiku_finder import Haiku
from stringhandle import clean_string
from leaderboard import leaderboard_obj
from counter import Counter
from globals import bot_notice
current = os.path.dirname(os.path.realpath(__file__))
parent_directory = os.path.dirname(current)
sys.path.append(f"{parent_directory}/common")
from logprint import custom_print

class RedditBot:
  def __init__(self, filename, reddit):
    self.reddit = reddit
    self.response_list = []
    self.leaderboard_comment = self.reddit.comment("i8lyefo")
    self.leaderboard = leaderboard_obj()
    self.COOLDOWN = 43200 # minimum time between replies

    with open(filename) as csv_file:
      csv_reader = csv.reader(csv_file, delimiter=",")
      for row in csv_reader: self.response_list.append({
        'phrase': clean_string(row[0]),
        'reply': row[1]
        })

  # function that determines if a string captured as a comment (passed as an argument).
  def find_match(self, comment):
    # go through response list and see if the phrase in the comment (cleaned) is contained in the 'phrase' key of response_list
    for i,  dictionary in enumerate(self.response_list):
      if dictionary['phrase'] in clean_string(comment.body):
        self.make_reply(i, comment)

    the_comment = str(comment.body)
    the_author = str(comment.author.name)
    the_haiku = Haiku(the_comment, the_author)
    printable_haiku = the_haiku.get_haiku()
    if printable_haiku != None:
      self.force_reply(printable_haiku, comment)
      
  # determines if enough time has passed between comments
  def cooled_down (self, i):
    #custom_print(datetime.now()) # print date and time of comment
    # pass the response list onto a variable "dictionary"
    dictionary = self.response_list[i]
    # check if there is not a key named "last_posted"
    if 'last_posted' not in dictionary.keys():
      return True # if there isn't, this means there is no previous comment, proceed
    now = datetime.now() # take the timestamp now
    duration = now - dictionary['last_posted'] # calculate time since last comment
    duration_seconds = duration.total_seconds() # get the time in secs
    if duration_seconds >= self.COOLDOWN: # if it's longer than the COOLDOWN time
      return True # proceed
    custom_print("[Coudln't post reply. COOLDOWN time: " + str(self.COOLDOWN - duration_seconds)+ "]") # inform reply couln't be done
    return False

  # this function actually makes the reply if cooled down returs true
  def make_reply(self, i, comment):
    dictionary = self.response_list[i] # get response list as a dictionary
    if dictionary['phrase'] != "this is the mae": # if the phrase commented is not TitM
      try:
        new_reply = dictionary['reply'] # just reply (do not check for COOLDOWN)
        self.print_log(comment, new_reply) # print log
        comment.reply(body = new_reply) # reply
      except Exception as e: # if error is found, print the error to console
        custom_print(e)
      return # exit
    # Otherwise
    try: # attempt to post a reply (if COOLDOWN allows)
      counter = Counter() # make a counter object to get the number of comments in emoji
      titm = counter.getNinEmojiNupdate() # this also updates the counter
      new_reply = f"{dictionary['reply']}\n\n💖 I have counted this phrase being used a total of: {titm} times\n\n" # create a reply string
      self.leaderboard.update_leaderboard(comment) # update leaderboard
      leaderboard_link = "🏆 [Click here to see the Leaderboard](https://www.reddit.com/r/this_is_the_mae/comments/upo4xx) 🏆\n\n"
      new_reply += leaderboard_link # add leaderboard to string
      new_reply += bot_notice.replace(" ", "&#x2005;")
      self.print_log(comment, new_reply) # print log of the comment
      self.leaderboard_comment.edit(body = self.leaderboard.print_leaderboard())
      if self.cooled_down(i): # if reply can be posted (COOLDOWN permited)
        comment.reply(body = new_reply) # reply the comment
    except Exception as e: # if an error is found, print a log of it
      custom_print(e)
    
    
    now = datetime.now()
    self.response_list[i]['last_posted'] = now

  # forces a reply. USE WITH CAUTION, DOES NOT CHECK COOLDOWN
  def force_reply(self, new_reply, comment):
    try:
      self.print_log(comment, new_reply)
      comment.reply(body = new_reply)
      Title = f"New Haiku by u/{str(comment.author.name)}"
      #haiku_flair = '44820824-d3c8-11ec-9918-967c005427ac'
      self.reddit.subreddit("this_is_the_mae").submit(Title, selftext = new_reply)
    except Exception as e:
      custom_print(e)
      
  def print_log(self, comment, reply):
    reply = reply.replace("\n\n", "\n    ")
    custom_print(f"{str(comment.submission)}\n  {str(comment.author)}:\n    {str(comment.body)}\n  Mae:\n    {reply}\n")