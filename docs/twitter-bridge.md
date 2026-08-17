# Twitter to Reddit bridge

The Reddit service is a consumer of the canonical Twitter service. It never opens `twitter.pb`, never runs FxTwitter and never classifies Daily Task worthiness itself.

## Delivery lifecycle

For each item returned by `TwitterClient.pending('reddit')`:

1. create or resume the local Reddit fanout record;
2. publish the primary Reddit submission in `r/nyaonearth`;
3. persist the primary post ID before any legacy-subreddit action;
4. create the `r/catgirlcoin` native crosspost, or a documented fallback when native crosspost is not possible;
5. persist the legacy post ID/mode independently;
6. only after both deliveries are durable, acknowledge Twitter with an opaque Reddit-owned receipt.

A restart after step 3 resumes at step 4. A restart after Twitter accepts step 6 but before Reddit stores its local acknowledgement flag is recovered by reading the canonical Twitter item and observing `redditDone=true`.

The bridge currently depends on an abstract `TwitterRedditPublisher`. No live publisher is wired into `src/main.ts`, so this branch cannot post, crosspost or pin real Reddit content accidentally.

## Daily Task review

Reddit does not generate a Daily Task and does not read Telegram stores.

After normal tweet fanout is complete, Reddit synchronises the canonical Twitter item. This resolves three states:

- `worthy=false`: no review is required and Reddit stops polling for one;
- `worthy=null`: classification is still pending;
- `worthy=true`: query Telegram's authenticated read-only Daily Review API.

A missing review is normal while Telegram is still preparing or presenting it.

When the canonical first-wins decision becomes:

- `reject`: retain both normal Reddit posts and do not pin them;
- `approve`: pin the already-existing primary and legacy posts independently.

Each pin has its own durable completion bit. If one subreddit pin fails, approval is already preserved and the missing pin is retried without depending on the review API being available again.

## Sticky safety

The bridge only models pin intent and durable per-subreddit completion. The concrete Reddit publisher will not be enabled until the live audit records current sticky slots and a safe non-evicting policy is implemented. No existing unrelated sticky may be displaced implicitly.
