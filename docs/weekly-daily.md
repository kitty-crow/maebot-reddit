# Weekly Daily Task relay

Mae Telegram owns the canonical weekly Daily Task synthesis and first-wins moderator approval flow. Mae Reddit does not generate a competing summary and does not open Telegram's Daily Task or review stores.

The Reddit runtime consumes the authenticated loopback Daily Review API and considers only weekly reviews that are both approved and applied to the canonical shared Daily Task. Rejected, unresolved, expired or not-yet-applied weekly reviews are never published.

For each approved week, Reddit creates one durable logical delivery keyed by the weekly review identity. In normal two-subreddit mode it publishes the approved summary to the primary subreddit and then creates the legacy native crosspost, falling back to a linked self-post only if native crossposting fails. In single-subreddit mode it publishes only the primary post.

The generic Reddit action journal records primary and legacy completion independently. A restart or retry therefore cannot intentionally duplicate an already-recorded weekly post, and a failed legacy delivery retries only that side. The publisher also embeds a deterministic hidden weekly marker and inspects recent posts before creating a new one, providing recovery for a crash that happens after Reddit accepts a post but before the local action journal is updated.

Weekly summaries use the `Minor Announcement :lisa:` post flair. Each published weekly summary is added to Reddit's Community Highlights through the authenticated sticky API. The intended Community Highlight label is `Announcement`, and the highlight lifetime is `This week`: Mae records that policy durably and removes the highlight at the start of the following weekly window. The Reddit post itself remains in place after the highlight expires.

Reddit's documented OAuth sticky endpoint does not expose the newer Community Highlight label or native expiry controls. The runtime therefore uses the supported sticky/highlight operation, records `Announcement` as the canonical presentation policy, and enforces `This week` by a durable bot-side unhighlight action. The same API currently exposes four numbered programmatic highlight positions, so Mae considers four slots and refuses to evict an unrelated highlight when all four are occupied.

A tweet promoted through the canonical Daily Task review follows a different highlight lifetime: after moderator approval its already-published Reddit post is highlighted as an `Announcement` with no expiry. This is the existing Twitter-to-Reddit approval/pin path, now operating across all four API-visible highlight slots.

The canonical weekly review may carry the newest available Daily Task image or MP4 as attention-grabbing presentation media. Telegram keeps that media with the approved weekly Daily Task and exposes authenticated media metadata and bytes through its review boundary. The current Reddit relay preserves awareness of that media in its canonical input and delivery journal, while Reddit publication remains a text self-post/crosspost path until a proven native Reddit media-upload boundary is added.
