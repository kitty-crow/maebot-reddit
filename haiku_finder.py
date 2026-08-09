import syllables
from globals import bot_notice
from syllable_fixes import fixes
import sys
import os
from stringhandle import clean_datetime
current = os.path.dirname(os.path.realpath(__file__))
parent_directory = os.path.dirname(current)
sys.path.append(f"{parent_directory}/common")
from database import database


# Silly module that checks if a comment has 17 syllables in a pattern of "5, 7, 5"
#    if this happens, it will reply the same comment in a Haiku form
class Haiku:
  def __init__(self, line, the_author):
    self.words = line.split() # Create a list of the words in the comment as a string
    self.lines = ["", "", ""] # Buffer for the lines of the Haiku as a list of strings
    self.lines_ok = [False, False, False] # Used to check if the lines match the "Haiku pattern"
    self.states = ((0, 0, 0), (1, 0, 0), (1, 1, 0), (1, 1, 1)) # States of progress
    self.haiku_pattern = (5, 7, 5) # Definition of the Haiku pattern
    self.is_a_candidate = False # Used to prevent spamming. Only accept comments of 17 syllables
    self.is_a_haiku = False # Used to check if the comment can be considered a Haiku
    self.output = "" # Buffer of the reply string
    self.Author = str(the_author) # Author of the haiku
    self.db = database("database.db")

  # function that counts the syllables in a word. Relies on the library "syllables"
    # it applies a few fixes to words whose syllables are estimated incorrectly
  def count_syllables(self, word):
    out = 0
    if word.lower() in fixes["nones"]:
      out = 0
    elif word.lower() in fixes["monos"]:
      out = 1
    elif word.lower() in fixes["duos"]:
      out = 2
    elif word.lower() in fixes["trios"]:
      out = 3
    else:
      out = syllables.estimate(word)
    return out

  def count_syllables_comment(self): # Returns the total number of syllables in the whole comment.
    syll = 0
    for i in range(len(self.words)):
      syll += self.count_syllables(self.words[i])
    return syll
      
  # function that returns True if the comment has a Haiku pattern
  def find_haiku(self):
    syllables_in_line = 0 # Buffers the number of syllables on each "line"
    j = 0
    for i, indx in enumerate(self.words): # Check the numbr of syllables in a line
      syllables_in_line += self.count_syllables(self.words[i]) # Add syllables of each word in line
      if self.lines_ok != list(self.states[j]): # If currently not building line j
        return self.is_a_haiku # Return it is not a Haiku
      if syllables_in_line > self.haiku_pattern[j]: # If number of syllables > pattern[j]
        return self.is_a_haiku # Return it is not a Haiku
      self.lines[j] += f"{self.words[i]} " # Start building the line with the words counted
      if syllables_in_line == self.haiku_pattern[j]: # If and when the number of sylables are in pattern[j]
        self.lines_ok[j] = True # Define line j as complete
        j += 1 if j < len(self.haiku_pattern) else 0 # Add one to j if in range of pattern
        syllables_in_line = 0 # Reset the syllables buffer
        
      if self.lines_ok == list(self.states[3]): # If line 3 is complete
        if syllables_in_line != self.haiku_pattern[2]: # If the number of syllables in line are not 5
          return self.is_a_haiku # Return it is not a Haiku
        self.is_a_candidate = True # It could be a Haiku!
        break # Stop the loop

    if not self.is_a_candidate: # If comment is not a Haiku candidate
      return self.is_a_haiku # Return it is not a Haiku
    if self.count_syllables_comment() != 17: # If there are not 17, it is not a Haiku
      return self.is_a_haiku # This is done to prevent the bot funding haikus on every single comment.
    self.is_a_haiku = True # If program reaches this line, the comment is a Haiku
        
    if self.is_a_haiku: # If the comment is a Haiku
      self.output = "\n\n".join(str(lne) for lne in self.lines) # The string that will be the reply of the bot.
      
    return self.is_a_haiku # Return True if it's a Haiku or False if it is not

  # Function that returns the output string if the comment is a Haiku
  def get_haiku(self):
    if self.find_haiku(): # If it is a Haiku
      ##################### DATABASE SAVING #####################
      Haikus = self.db["Haikus"]
      if self.Author in Haikus:
        haikus = Haikus.get(self.Author)[:] + [self.output]
        Haikus.update({self.Author: haikus})
        self.db["Haikus"] = Haikus
      else:
        Haikus.update({self.Author: [self.output]})
      ####################### FILE SAVING #######################
      self.output += f"\n~ u/{self.Author}" # Add the Author to the String
      path = f"Haikus/{self.Author}"
      filename = f"{clean_datetime()}.haiku"
      filepath = f"{path}/{filename}"
      try:
        os.mkdir(path)
      except OSError:
        pass
      with open(filepath, 'a') as output_file:
        output_file.write(self.output.replace("\n\n", "\n"))
      ###########################################################
    # Add bot notice and some info about Haikus
      self.output += "\n\n Nice [Haiku!](https://haiku-poetry.org/what-is-haiku.html)\n\n" + bot_notice.replace(" ", "&#x2005;")
      return self.output