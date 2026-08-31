# Member Mod Notes experiment

This experiment builds moderator notes for the canonical Mae reputation membership without rediscovering users from Reddit flair listings.

## Sources of truth

- `data/reputation.pb` remains authoritative for member identity, reputation score, status and flair state.
- Moderators are identified from that canonical reputation inventory and skipped.
- `data/memberModNotes.pb` is a separate protobuf-backed store containing only the member-note artefact and its provenance/application state. It does not copy reputation score or flair fields.
- Reddit is queried only for each member's recent comment history and for native Mod Note writes.

## Comment sample

For each non-moderator reputation member, the experiment scans the user's Reddit comment listing until it finds the 10 most recent comments across `r/catgirlcoin` and `r/nyaonearth` combined. Comments from every other subreddit are discarded before classification. Reddit listings expose at most roughly 1,000 recent items, so a user with more than 1,000 newer comments elsewhere may yield fewer than 10 accessible moderated-community comments.

The selected comments are sent individually through the same `RedditModerationClassifier` and model/configuration used by Mae's live tier-based moderation. In apply mode, sampled comments that are not already present in `reputation.pb` are recorded through the normal reputation path, so the scoring is idempotent by Reddit fullname.

After the per-comment classifications, the same configured OpenAI model produces one short cross-community contribution summary and one native Reddit Mod Note label:

- no label (`NONE` internally)
- Helpful (`HELPFUL_USER`)
- Good Contributor (`SOLID_CONTRIBUTOR`)
- Spam Watch (`SPAM_WATCH`)
- Spam Warning (`SPAM_WARNING`)
- Abuse Warning (`ABUSE_WARNING`)

The visible note text is limited to Reddit's 250-character limit and has the form:

`Mae score: <current score>. <short contribution summary>`

A single canonical assessment is generated per member. In apply mode the same note is written to both moderated subreddits so moderators see the same cross-community context from either community.

## Store

`memberModNotes.pb` stores one record per non-moderator member with:

- username
- exact note text
- generated summary
- Reddit label constant
- the sampled comment fullnames
- generation timestamp
- communities where the note was successfully applied
- the latest error, if any

Existing generated records make the job resumable. `--refresh` forces a fresh 10-comment assessment.

## Run

Preview and build/update the separate protobuf store without changing reputation or Reddit Mod Notes:

```sh
bun run experiment:member-notes
```

Run the full experiment, including canonical scoring of previously untracked sampled comments and native Mod Note writes to both communities:

```sh
bun run experiment:member-notes -- --apply
```

Test one member only:

```sh
bun run experiment:member-notes -- --user=SomeRedditUser
bun run experiment:member-notes -- --apply --user=SomeRedditUser
```

Force regeneration of an existing assessment:

```sh
bun run experiment:member-notes -- --refresh --user=SomeRedditUser
```

The note-store path can be overridden with `REDDIT_MEMBER_MOD_NOTES_FILE`; its default is `data/memberModNotes.pb`.
