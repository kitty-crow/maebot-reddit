# Determines if two questions are similar and how much
import string
import os
import sys
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.feature_extraction.text import CountVectorizer
from globals import stopwords, too_similar_reply_1, too_similar_reply_2, bot_notice
current = os.path.dirname(os.path.realpath(__file__))
parent_directory = os.path.split(os.path.dirname(current))[0]
sys.path.append(f"{parent_directory}/common")
from logprint import custom_print
from database import database

db = database("database.db")

# Removes all stopwords and punctuation marks from a string
def clean_string(text):
  text = ''.join([word for word in text if word not in string.punctuation])
  text = text.lower()
  text = ' '.join([word for word in text.split() if word not in stopwords])
  return text

# Determines the angle difference between two vectors in a number from 0 to 1 where 1 means both vectors coincide.
def cosine_sim_vectors(vec1, vec2):
  vec1 = vec1.reshape(1, -1)
  vec2 = vec2.reshape(1, -1)
  return cosine_similarity(vec1, vec2)[0][0]

# Finds the similarity between a submission string and the questions in the database.
def find_similarity(submission):
  questions = {} # Dictionary that will contain the questions in the database

  for question_id in list(db.keys()):  # Populate the dictionary
    # Never compare a replayed question with its own stored title.
    if str(question_id) == str(submission.id):
      continue
    questions[question_id] = clean_string(db[question_id]) # Clean the questions from stopwords and punctuation marks

  question_contents = list(questions.values()) # Get the values in the dictionary as a list
  question_contents.append(clean_string(submission.title)) # Add the submission to the list after cleaning it
  
  vectoriser = CountVectorizer().fit_transform(question_contents) # Convert elements on the list to vectors
  vectors = vectoriser.toarray() # Create array of vectors
  for i in range(len(question_contents) - 1): # Compare the last element on the vector array to the others
    sim = cosine_sim_vectors(vectors[i], vectors[-1]) # Determine angle betweeen the last vector and all the others
    if sim > 0.49: # If similarity is above 49%
      answer = too_similar_reply_1 + list(questions.keys())[i] # Build reply string
      answer += too_similar_reply_2 + bot_notice.replace(" ", "&#x2005;")
      comment = submission.reply(body = answer) # Reply submission with reply string
      comment.mod.distinguish(sticky=True) # Distinguish and stick
      custom_print(answer) # Add to log
      custom_print(f"Similarity: {str(round(sim * 100))}%.")
      return False # Return false if question is too similar to others
  return True # Return true otherwise