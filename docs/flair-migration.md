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
4. stop the normal Mae runtime when using exclusive migration pacing, then run `bun run clone:flairs`; the command targets `r/nyaonearth` explicitly and resumes already-correct target state rather than starting over;
5. verify the schema-2 bootstrap result;
6. restart Mae on the green bootstrap code;
7. run the one-off custom emoji pre-flight and migration separately;
8. only after the remaining migration work is verified, set `REDDIT_PRIMARY_SUBREDDIT=nyaonearth` when the cross-community publishing/post-mirror cutover is desired.

The bootstrap command enforces the safety-critical part of this order. Before exposing any target permanent ban it checks that every canonical `banned`/`scam` user has both Mae's current NyaOnEarth projection checkpoint and a live Reddit mute. If either is missing, the command aborts.

## Moderator permissions

Mae must be a moderator of both communities with:

- `access` — user bans and communication restrictions;
- `flair` — user/post flair templates and assignments;
- `posts` — sticky/post operations;
- `mail` — Modmail operation.

`config` / Manage Settings is **not** required for the main community bootstrap.

Custom emoji mutation is a separate one-off subreddit appearance/settings operation performed with an interactively authenticated moderator account. Mae's normal credentials and moderator permissions remain unchanged.

## Custom emojis

Custom emoji migration is deliberately separate from the schema-2 community bootstrap.

First run the read-only pre-flight:

```bash
bun run preflight:emojis
```

The command asks for the Reddit username normally and reads the password with terminal echo disabled. The credentials exist only in process memory for that invocation; they are not written to `.env`, command-line arguments, shell history or migration state.

The pre-flight performs no Reddit mutations. It authenticates the entered account and checks the exact requirements of this one-off clone:

- CatgirlCoin: the account is a moderator and can read the custom-emoji inventory;
- NyaOnEarth: the account is a moderator, has `config` / Manage Settings, and can read the custom-emoji inventory.

It also reports the granted moderator permissions and visible emoji count for each community. A PASS means the entered account satisfies the authority/read prerequisites used by the real clone.

Then run:

```bash
bun run clone:emojis
```

The clone prompts for the credentials again rather than persisting them. Before its first mutation it repeats the same read-only pre-flight internally. The same authenticated account is used to read both source and target emoji inventories and to write the target state.

Emoji migration:

1. inventories CatgirlCoin source emojis;
2. inventories NyaOnEarth target emojis;
3. preserves NyaOnEarth-only emoji names;
4. compares same-name image assets by SHA-256;
5. skips exact matches;
6. repairs permission-only differences;
7. uploads missing or different assets through Reddit's upload lease and S3 flow;
8. preserves `mod_flair_only`, `post_flair_allowed` and `user_flair_allowed`;
9. verifies the final target inventory with bounded retries because Reddit may register new emoji asynchronously.

Raw S3 asset transfer is not counted as a Reddit Data API request. OAuth lease/registration operations remain under the shared Reddit rate-budget coordinator.

## Flair templates and local IDs

Reddit flair template UUIDs are subreddit-local implementation identifiers. A CatgirlCoin UUID must never be written directly into NyaOnEarth.

`bun run clone:flairs`:

1. reads CatgirlCoin user and post flair templates;
2. creates any missing presentation-equivalent templates in NyaOnEarth;
3. requires each source template to resolve to exactly one destination template;
4. records the source-template → target-template mapping in `data/flairs.json`;
5. projects each canonical user's desired CatgirlCoin flair through that local mapping.

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

The bootstrap is designed to converge rather than create duplicate semantic templates or sticky pairs. An interrupted run must preserve useful Reddit-side progress.

On rerun it re-inventories live NyaOnEarth state and:

- reuses presentation-equivalent flair templates;
- skips already-correct visible user flairs;
- reuses existing sticky clones where possible;
- skips already-present canonical bans.

For Reddit's legacy `/api/flairlist`, an omitted `flair_template_id` means unknown rather than wrong. Correct text with an omitted UUID must not trigger a mass rewrite. An explicitly wrong UUID or wrong text still requires restoration.

Before reporting success the bootstrap verifies:

- every source flair template has exactly one destination presentation match;
- canonical target member flairs no longer require restoration;
- every canonical permanent user is live-muted and banned in NyaOnEarth;
- no unexplained target bans remain;
- sticky source/target pairs are persisted in mirror state;
- the final schema-2 catalogue is written atomically.

A failed or interrupted apply must be investigated before rerun. Do not delete canonical `reputation.pb` to make migration errors disappear; reconcile the live/canonical mismatch that caused the fail-closed check.

## Not part of the main bootstrap

The main bootstrap does not copy:

- custom emoji assets (use the separate interactive one-off command after schema 2 exists);
- subscribers;
- historical comments;
- the historical non-sticky post archive;
- vote totals;
- Modmail history as new moderation events;
- moderator membership/permission assignments;
- arbitrary subreddit settings.

When NyaOnEarth Modmail is first activated, existing conversations are seeded as context without replaying their old participant messages as new behavioural offences. Only messages arriving after that activation boundary enter the normal relay/private-moderation stream.
