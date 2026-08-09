import re
from datetime import datetime

# function that converts a raw string into that string stripped of all numbers and symbols (leaves only letters)
def clean_string(raw_string):
  cleaned_string = raw_string.lower()
  cleaned_string = re.sub(r'[^A-Za-z0-9 ]+', '', cleaned_string)
  return cleaned_string

def clean_datetime():  
  cleaned_datetime = str(datetime.now()).lower()
  cleaned_datetime = cleaned_datetime.replace(" ", "")
  cleaned_datetime = re.sub(r'[^A-Za-z0-9 ]+', '', cleaned_datetime)
  return cleaned_datetime