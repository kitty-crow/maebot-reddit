# Strings and lists used for comparisons

# Stopwords are words in english that are ignored when building string vectors
stopwords = ['i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', "you're", "you've", "you'll", "you'd", 'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', "she's", 'her', 'hers', 'herself', 'it', "it's", 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'this', 'that', "that'll", 'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'a', 'an', 'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'don', "don't", 'should', "should've", 'now', 'd', 'll', 'm', 'o', 're', 've', 'y', 'ain', 'aren', "aren't", 'couldn', "couldn't", 'didn', "didn't", 'doesn', "doesn't", 'hadn', "hadn't", 'hasn', "hasn't", 'haven', "haven't", 'isn', "isn't", 'ma', 'mightn', "mightn't", 'mustn', "mustn't", 'needn', "needn't", 'shan', "shan't", 'shouldn', "shouldn't", 'wasn', "wasn't", 'weren', "weren't", 'won', "won't", 'wouldn', "wouldn't", "catgirl", "catgirls"]

# Part 1 of the reply to use if questions are too similar
too_similar_reply_1 = "Oh~! It looks like this question has been asked before, nya~! How adorable! UwU You might find some paw-some answers by taking a peek at [this question](https://reddit.com/r/catgirlcoin/comments/"
# Part 2 of thr same
too_similar_reply_2 = ").\n\nIf this answers your question, nya~! Why not give the other post a sweet little upvote, UwU? That way, other holders can find it more easily, nya~!\n\n"
# Reply to use if the question used does not follow the standard
notaquestion = "You have selected the 'Question' flair for your post, but it appears that your post is not really a question! In order for a submission to be considered a question, you must state the question itself on the title. It must end with a question mark '?' and it must contain a question keyword. For more info, please check [this post](https://www.reddit.com/r/catgirlcoin/comments/ud8tj3/guidelines_to_ask_questions/). \n\n I have gone ahead and changed the flair of the submission for you! \n\n If I got it wrong, please [message the moderators through modmail](https://www.reddit.com/message/compose?to=/r/{{subreddit}}&subject=&message=) so that they can assess your submission manually! \n\n"
# Notice of automatic reply
bot_notice = "\n---\n^beep boop! I am a bot. This response is automated."
# Regex code to determine if a question follows the standard
q_regex = r"(what|when|why|which|who|how|whose|whom|where|will|would|have|has|had|does|do|did|how|are|is|can).+\w+(.?)+(?=\?+$)\?*"

min_karma_post = 2

no_flair_notice = "Dear OP, your submission has been removed because you have not selected a user flair UwU.\n\nWe kindly request all users to pick a user flair before subitting, nya! These are essential in this subreddit as they effectively deter spam bots from posting. To ensure a smooth experience for everyone, please refer to [this post](https://www.reddit.com/r/catgirlcoin/comments/szkmg7/now_you_can_chose_your_favourite_s1_catgirl_as/) for instructions on how to select a user flair. Once you've done that, feel free to resubmit your post. Thank you, nya!\n"

banned_from_posting = "Oh nyo! It seems like your behaviour in this subreddit has made the moderators mark your account as 'uncivil', nya~! That means you're not allowed to make submissions, UwU. Your submission has been removed, nya~!\nFeel free to contact the moderator through Mod Mail to rectify the situation!\n"

restricted_from_posting = f"Oh, oh, nya~! It looks like your behaviour in this subreddit has caught the attention of the moderators, nya! They've marked your account as 'warned', which means you'll need a karma of more than {min_karma_post*10} to make submissions here again, nya~! Keep participating and spreading the kitty love before making new submissions. You are also welcome to contact the moderators through Mod Mail to rectify the situation UwU!\n"

min_karma_removal = f"Oh dear, nya~!, it seems your post has been removed because you haven't reached the minimum post karma requirement to participate in this pawsome community, UwU\n\nFor Catgirl Coin, you'll need a minimum karma of {min_karma_post} to make posts, nya! But don't worry, nya~! You can start by making posts in other communities and getting familiar with how Reddit works, UwU. Once you've gathered enough post karma, you're welcome to come back and join us again!\n\nIf you have any questions, our super-friendly catgirls are here to help you in our  [Discord Server](https://discord.gg/catgirlcoin) or in our [Telegram Chat](https://t.me/catgirlcoin), nya~!\n"

banned_css_classes = ("u", "s")

restricted_css_classes = ("w")