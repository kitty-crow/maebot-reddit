# Twitter Reddit flairs

Mae assigns a post flair to every Reddit submission created from the canonical Twitter service.

- Daily Task-worthy / major announcement tweets: `Announcement :catgirl-moon:`
- Ordinary Twitter posts: `Minor Announcement :lisa:`

The publisher resolves the exact post-flair template text in the target subreddit and passes its template ID in the same Reddit `/api/submit` request that creates the post. Missing or ambiguous flair templates fail the delivery rather than silently publishing with the wrong flair.

In the temporary single-subreddit deployment this applies to `r/catgirlcoin`. When the two-subreddit deployment is restored, the same semantic names are independently resolved in each target subreddit so subreddit-local flair UUIDs are never reused across communities.
