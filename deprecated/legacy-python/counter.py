import sys
import os
current = os.path.dirname(os.path.realpath(__file__))
parent_directory = os.path.dirname(current)
sys.path.append(f"{parent_directory}/common")
from database import database

# Handles the counting of how many messages have been repplied
class Counter:
  def __init__(self):
    self.db = database("database.db")
    self.numemojis = { 
      0: "0️⃣", 
      1: "1️⃣",
      2: "2️⃣",
      3: "3️⃣",
      4: "4️⃣",
      5: "5️⃣",
      6: "6️⃣",
      7: "7️⃣",
      8: "8️⃣",
      9: "9️⃣"
    }

  #function that adds 1 to the counter
  def update_counter(self):
    self.db['titm'] += 1
    return self.db['titm'] # return n of comments

  # function that gets an int and returns it in emojis while updating the counter
  def getNinEmojiNupdate(self):
    return self.num_to_emoji(self.update_counter())

  # function that converts a string of numbers into a string of emojis representing those numbers
  def num_to_emoji(self, number):
    num_list = [int(a) for a in str(number)]
    output = ""
    for i, _ in enumerate(num_list):
      output += self.numemojis.get(num_list[i])
    return output