# CatgirlCoin → NyaOnEarth community bootstrap

## Authority and direction

This migration is deliberately one-way:

- canonical/source community: `r/catgirlcoin`
- target community: `r/nyaonearth`

Mae has one Reddit runtime and one canonical reputation store. `r/nyaonearth` is a second moderation surface, not a second reputation system.

Canonical member state lives in `data/reputation.pb`:

- points and tier;
- ordinary/warned/uncivil/banned/scam status;
- moderation history;
- discipline and communication-restriction intent.

Legacy Python databases, `warned_users`/`banned_users` arrays and old CSS-only interpretations are migration evidence only. They are not authority for this community bootstrap.

## Required order

Do not switch Reddit publishing/mirroring to NyaOnEarth merely to begin moderation there. Dual-community moderation is independent of the publishing `PRIMARY` setting.

The required activation order is:

1. deploy this runtime while keeping the existing publishing route if desired (`REDDIT_SOURCE_SUBREDDIT=catgirlcoin`, `REDDIT_PRIMARY_SUBREDDIT=catgirlcoin` is valid before bootstrap);
2. start Mae with canonical moderation enabled; she immediately ingests/moderates posts, comments and Modmail from both CatgirlCoin and NyaOnEarth using the one `reputation.pb`;
3. let the NyaOnEarth projection establish the existing canonical communication restrictions there and verify them against Reddit's live muted-user relationship;
4. stop the normal Mae runtime when using exclusive migration pacing, then run `bun run clone:flairs`; the command targets `r/nyaonearth` explicitly, clones custom emojis before flair templates and resumes already-correct target state rather than starting over;
5. verify the bootstrap result;
6. only after bootstrap, set `REDDIT_PRIMARY_SUBREDDIT=nyaonearth` and restart when the cross-community publishing/post-mirror cutover is desired.

The bootstrap command enforces the safety-critical part of this order. Before exposing any target permanent ban it checks that every canonical `banned`/`scam` user has both Mae's current NyaOnEarth projection checkpoint and a live Reddit mute. If either is missing, the command aborts.

## Moderator permissions

Mae must be a moderator of both communities with the permissions required by each side of the migration:

- `access` — user bans and communication restrictions;
- `flair` — user/post flair templates and assignments;
- `posts` — sticky/post operations;
- `mail` — Modmail operation;
- target `config` / Manage Settings — required for NyaOnEarth custom emoji creation and permission changes.

The source CatgirlCoin side does not require `config` merely to inventory its existing custom emojis. `wiki` may be useful for other Mae features but is not an apply prerequisite here.

Custom emoji migration is a subreddit appearance/settings operation on Reddit, not merely a flair operation. The reusable emoji migration path therefore rechecks NyaOnEarth `config` before it inventories, downloads or writes emoji assets. This same preflight protects both the integrated bootstrap and the standalone emoji migration command.

## Custom emojis

The integrated community bootstrap migrates custom emojis before cloning flair templates so flair strings such as `:catgirl-moon:`, `:lisa:` and `:mae:` never depend on missing target assets.

Emoji migration:

1. inventories source and target custom emojis;
2. preserves NyaOnEarth-only emoji names;
3. compares same-name image assets by SHA-256;
4. skips exact matches;
5. repairs permission-only differences;
6. uploads missing or different assets through Reddit's upload lease and S3 flow;
7. preserves `mod_flair_only`, `post_flair_allowed` and `user_flair_allowed`;
8. verifies the final target inventory with bounded retries because Reddit may register new emoji asynchronously.

Raw S3 asset transfer is not counted as a Reddit Data API request. The OAuth lease/registration operations remain under Mae's shared Reddit rate-budget coordinator.

## Flair templates and local IDs

Reddit flair template UUIDs are subreddit-local implementation identifiers. A CatgirlCoin UUID must never be written directly into NyaOnEarth.

`bun run clone:flairs`:

1. migrates CatgirlCoin custom emojis to NyaOnEarth first;
2. reads CatgirlCoin user and post flair templates;
3. creates any missing presentation-equivalent templates in NyaOnEarth;
4. requires each source template to resolve to exactly one destination template;
5. records the source-template → target-template mapping in `data/flairs.json`;
6. projects each canonical user's desired CatgirlCoin flair through that local mapping.

Moderator flairs are not overwritten by member-reputation projection. Users marked `unmapped` or `needsReview` cause the bootstrap to fail rather than guess, except for the explicitly centralised retired-moderator legacy exceptions documented by the reputation tracking layer.

The final `data/flairs.json` is schema 2. Its successful atomic rename is the activation marker for ongoing NyaOnEarth ban/flair reconciliation. A missing or older schema-1 catalogue is treated as pre-bootstrap historical state: it does not block Mae from starting dual-community moderation and it does not activate target ban/flair projection.

## Tier and moderation projection

The target assignment comes from canonical reputation state, not from blindly copying the currently visible CatgirlCoin assignment.

Current positive tiers are:

- 1–9: tier 1;
- 10–99: tier 2;
- 100–999: tier 3;
- 1000–9998: tier 4;
- 9999: tier 5 / Pawsome contributor;
- moderators: tier 9 and exempt from ordinary member mutation.

Current negative states are:

- warned: 0 through -3;
- uncivil: -4 through -9;
- permanent-ban trigger: -10, clamped to -999,999,999;
- scam/prohibited malicious promotion: immediate permanent floor.

**Uncivil is recoverable and is not a permanent-ban alias.** An old `u` flair must never by itself become a target permanent ban.

Only canonical users whose status is `banned` or `scam` belong in the permanent target-ban set.

## Ban and communication-state preflight

Before any target write, the bootstrap fails closed if:

- the configured canonical source is not CatgirlCoin;
- the publishing primary is neither the valid pre-bootstrap CatgirlCoin value nor the post-cutover NyaOnEarth value;
- canonical reputation is not bootstrapped;
- Mae lacks a required moderator permission in either community;
- NyaOnEarth lacks `config` / Manage Settings required by the emoji-first phase;
- any effective canonical user still requires semantic review;
- live CatgirlCoin bans differ from canonical `banned`/`scam` users;
- NyaOnEarth contains a live ban absent from canonical permanent state;
- any canonical permanent user lacks either Mae's current NyaOnEarth mute checkpoint or the corresponding live Reddit mute.

This makes CatgirlCoin's established moderation state, Mae's canonical reputation and the actual live target communication protection agree before NyaOnEarth is mutated.

The communication-protection projection must already be converged before bootstrap. The bootstrap verifies that precondition but does **not** refresh the permanent 28-day mutes again during the ban loop. Already-present target bans are also skipped, so an interrupted migration resumes from live Reddit state rather than replaying completed work.

After apply, both the target mute set and target ban set are reread. Every canonical permanent user must still be live-muted and banned before the command can report success.

## Sticky posts and mirror provenance

Current CatgirlCoin sticky slots are cloned or reused in NyaOnEarth. Their post flairs are translated through the target post-flair mapping.

The bootstrap records every source/target sticky pair into `data/postMirror.pb`. This is required even when the old source sticky is outside Reddit's recent listing window: without persisted provenance, the normal bidirectional mirror could mistake the newly created NyaOnEarth sticky for fresh target content and mirror it back into CatgirlCoin.

Historical CatgirlCoin posts are not bulk backfilled.

Normal post mirroring after publishing cutover is bidirectional and moderation-gated:

- an unseen post waits while its canonical moderation result is pending;
- an accepted or privileged post may be mirrored;
- a post requiring removal is not mirrored;
- Mae-created mirror copies are privileged/system activity and do not earn a second reputation contribution;
- persisted source/counterpart provenance prevents loops and restart replay.

## Continuous reconciliation after bootstrap

There is still only one canonical user state after migration.

CatgirlCoin remains the canonical flair/reputation surface in `reputation.pb`. NyaOnEarth owns only Reddit-local projection state such as its local flair UUIDs and communication-effect checkpoints.

After the schema-2 bootstrap catalogue exists, the NyaOnEarth projection periodically reconciles live Reddit moderation state from canonical reputation:

1. communication restrictions first;
2. missing canonical permanent bans second;
3. local flair assignment on the configured flair-reconciliation cadence.

Live muted-user state is checked against Mae's own projection checkpoint, so a manually removed permanent Mae mute is restored. Conversely, a live mute that Mae does not own is left alone rather than being automatically removed. Relationship inventories are throttled independently of the fast process poll to avoid unnecessary Reddit API pressure.

A failed attempt to establish a missing permanent communication restriction prevents that user's target ban from being applied in the same reconciliation. The target remains retryable independently of CatgirlCoin's successful effect checkpoint.

## Verification and reruns

The bootstrap is designed to converge rather than create duplicate semantic templates, emoji assets or sticky pairs. An interrupted run must preserve useful Reddit-side progress.

On rerun it re-inventories live NyaOnEarth state and:

- skips identical custom emojis and preserves target-only ones;
- reuses presentation-equivalent flair templates;
- skips already-correct visible user flairs;
- reuses existing sticky clones where possible;
- skips already-present canonical bans.

For Reddit's legacy `/api/flairlist`, an omitted `flair_template_id` means unknown rather than wrong. Correct text with an omitted UUID must not trigger a mass rewrite. An explicitly wrong UUID or wrong text still requires restoration.

Before reporting success the bootstrap verifies:

- custom emoji state converged;
- every source flair template has exactly one destination presentation match;
- canonical target member flairs no longer require restoration;
- every canonical permanent user is live-muted and banned in NyaOnEarth;
- no unexplained target bans remain;
- sticky source/target pairs are persisted in mirror state;
- the final schema-2 catalogue is written atomically.

A failed or interrupted apply must be investigated before rerun. Do not delete canonical `reputation.pb` to make migration errors disappear; reconcile the live/canonical mismatch that caused the fail-closed check.

## Not part of this bootstrap

This operation does not copy:

- subscribers;
- historical comments;
- the historical non-sticky post archive;
- vote totals;
- Modmail history as new moderation events;
- moderator membership/permission assignments;
- arbitrary subreddit settings unrelated to the explicitly migrated custom emoji assets.

When NyaOnEarth Modmail is first activated, existing conversations are seeded as context without replaying their old participant messages as new behavioural offences. Only messages arriving after that activation boundary enter the normal relay/private-moderation stream.
