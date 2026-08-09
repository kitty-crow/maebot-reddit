import sys
import os
current = os.path.dirname(os.path.realpath(__file__))
parent_directory = os.path.dirname(current)
sys.path.append(f"{parent_directory}/common")
from database import database

class leaderboard_obj:
  def __init__(self):
    self.db = database("database.db")
  # function that updates the number of times a redditor has commented "this is the mae"
  def update_leaderboard(self, comment):
    user = str(comment.author) # get the username of the redditor posting
    in_leaderboard = False # boolean used to determine if the redditor is already in the leaderboard
    for i in self.db['leaderboard']: # check the database of redditors
      if user == i: # if user is in the database
        in_leaderboard = True # take the name as it appear in the database (carries some metadata)
        break # exit for loop
      if in_leaderboard: # if a match was found
          self.db['leaderboard'][user] += 1 # increase the score by one
      else:
        self.db['leaderboard'][user] = 1 # if not, give the user a score of 1
  # function that returns a string containing the leaderboard
  def print_leaderboard(self):
    output = "🏆 This is the Μae Leaderboard 🏆\n\n"
    leaderboard = self.db['leaderboard'] # dictionary containing users and scores
    lb_list = list(map(list, leaderboard.items())) # convert the dictionary into a list    
    for i in range(len(lb_list) - 1): # bubble sorting the list by score (descending)
      for j in range(i + 1, len(lb_list)):
        if lb_list[i][1] < lb_list[j][1]:
          lb_list[i], lb_list[j] = lb_list[j], lb_list[i]
    self.db['leaderboard'] = dict(lb_list) # convert the sorted list into a dictionary
    leaders = list(self.db['leaderboard'].keys()) # make a list of the users in the sorted list
    scores = list(self.db['leaderboard'].values()) # make a list of scores for the users
    for i in range(len(self.db['leaderboard'])): # for the users in the list to print
      # add some cute emoji to the first three places
      if i == 0:
        output += "      🥇"
      elif i == 1:
        output += "      🥈"
      elif i == 2:
        output += "      🥉"
      else:
        output += "      "
      # Append a string to the output describing the leaderboard
      output += f"{i+1}. u/{leaders[i]}: {scores[i]}\n\n"
    return output