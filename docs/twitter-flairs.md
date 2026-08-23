# Twitter Reddit flairs

Mae assigns a post flair to every Reddit submission created from the canonical Twitter service.

- Daily Task-worthy / major announcement tweets: `Announcement :catgirl-moon:`
- Ordinary Twitter posts: `Minor Announcement :lisa:`

The publisher resolves the exact post-flair template text in the target subreddit and passes its template ID in the same Reddit `/api/submit` request that creates the post. Missing or ambiguous flair templates fail the delivery rather than silently publishing with the wrong flair.

A Daily Task-worthy tweet is not highlighted merely because it was classified as worthy. Once a moderator approves its canonical Daily Task review, Mae highlights the already-published Reddit post through the Twitter review bridge. The intended Community Highlight label is `Announcement`, and this actual Daily Task highlight has no expiry. Mae never schedules an automatic unhighlight for this path.

The public Reddit sticky/highlight API exposes four numbered programmatic positions but does not expose the newer Community Highlight label field. Mae therefore uses the supported highlight operation, records `Announcement` as the canonical presentation policy, searches all four API-visible positions, and refuses to evict unrelated highlighted posts when every API-visible position is occupied.

In the temporary single-subreddit deployment this applies to `r/catgirlcoin`. When the two-subreddit deployment is restored, the same semantic names are independently resolved in each target subreddit so subreddit-local flair UUIDs are never reused across communities.
