from logprint import custom_print
def over18(submission):
  if submission.over_18:
    submission.mod.flair(flair_template_id = "fcf37ef8-e5d7-11ec-9f79-f2d990a11841", css_class="bot")
    custom_print("NSFW post found: https://reddit.com" + submission.permalink)
    return False