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

Do not run `bun run clone:flairs` immediately after deploying code.

The required activation order is:

1. configure `REDDIT_SOURCE_SUBREDDIT=catgirlcoin` and `REDDIT_PRIMARY_SUBREDDIT=nyaonearth`;
2. start the dual-community Mae runtime;
3. let Mae ingest/moderate posts, comments and Modmail from both communities using the one canonical `reputation.pb`;
4. let the NyaOnEarth projection establish the existing canonical communication restrictions there;
5. only then run `bun run clone:flairs` to bootstrap target templates, canonical flairs, stickies and permanent bans.

The bootstrap command enforces this order. Before any subreddit mutation it checks that every canonical `banned`/`scam` user already has a current NyaOnEarth communication-projection checkpoint. If that projection has not converged, the command aborts.

## Moderator permissions

Mae must be a moderator of both communities with these permissions:

- `access` — user bans and communication restrictions;
- `flair` — user/post flair templates and assignments;
- `posts` — sticky/post operations;
- `mail` — Modmail operation.

`config` is not required for this bootstrap. `wiki` may be useful for other Mae features but is not an apply prerequisite here.

The bootstrap rechecks the required permissions itself rather than relying on a prior manual audit.

## Flair templates and local IDs

Reddit flair template UUIDs are subreddit-local implementation identifiers. A CatgirlCoin UUID must never be written directly into NyaOnEarth.

`bun run clone:flairs`:

1. reads CatgirlCoin user and post flair templates;
2. creates any missing presentation-equivalent templates in NyaOnEarth;
3. requires each source template to resolve to exactly one destination template;
4. records the source-template → target-template mapping in `data/flairs.json`;
5. projects each canonical user's desired CatgirlCoin flair through that local mapping.

Moderator flairs are not overwritten by member-reputation projection. Users marked `unmapped` or `needsReview` cause the bootstrap to fail rather than guess.

The final `data/flairs.json` is schema 2. Its successful atomic rename is the activation marker for ongoing NyaOnEarth ban/flair reconciliation. Before a completed schema-2 catalogue exists, the running target projection applies communication restrictions only and deliberately does not mass-clone bans or member flairs.

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

- source/target are not exactly CatgirlCoin → NyaOnEarth;
- canonical reputation is not bootstrapped;
- Mae lacks a required moderator permission in either community;
- any canonical user is still `unmapped` or `needsReview`;
- live CatgirlCoin bans differ from canonical `banned`/`scam` users;
- NyaOnEarth contains a live ban absent from canonical permanent state;
- any canonical permanent user lacks a current NyaOnEarth communication restriction.

This makes CatgirlCoin's established moderation state and Mae's canonical reputation agree before NyaOnEarth is mutated.

During apply, the target communication restriction is refreshed immediately before any newly exposed target permanent ban. The NyaOnEarth projection checkpoint is advanced with the successful mute write so normal runtime reconciliation does not duplicate it.

After apply, the target ban set is reread and verified against canonical permanent state.

## Sticky posts and mirror provenance

Current CatgirlCoin sticky slots are cloned or reused in NyaOnEarth. Their post flairs are translated through the target post-flair mapping.

The bootstrap records every source/target sticky pair into `data/postMirror.pb`. This is required even when the old source sticky is outside Reddit's recent listing window: without persisted provenance, the normal bidirectional mirror could mistake the newly created NyaOnEarth sticky for fresh target content and mirror it back into CatgirlCoin.

Historical CatgirlCoin posts are not bulk backfilled.

Normal post mirroring after cutover is bidirectional and moderation-gated:

- an unseen post waits while its canonical moderation result is pending;
- an accepted or privileged post may be mirrored;
- a post requiring removal is not mirrored;
- Mae-created mirror copies are privileged/system activity and do not earn a second reputation contribution;
- persisted source/counterpart provenance prevents loops and restart replay.

## Continuous reconciliation after bootstrap

There is still only one canonical user state after migration.

CatgirlCoin remains the canonical flair/reputation surface in `reputation.pb`. NyaOnEarth owns only Reddit-local projection state such as its local flair UUIDs and communication-effect checkpoints.

After the schema-2 bootstrap catalogue exists, each runtime poll reconciles NyaOnEarth moderation state from canonical reputation:

1. communication restrictions first;
2. missing canonical permanent bans second;
3. local flair assignment on the configured flair-reconciliation cadence.

A failed permanent communication-restriction write prevents that user's target ban from being applied on the same poll. The target remains retryable independently of CatgirlCoin's successful effect checkpoint.

## Verification and reruns

The bootstrap is designed to converge rather than create duplicate semantic templates or duplicate sticky pairs. It verifies, before reporting success:

- every source flair template has exactly one destination presentation match;
- canonical target member flairs no longer require restoration;
- every canonical permanent user is banned in NyaOnEarth;
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
- arbitrary subreddit preferences requiring `config` permission.

When NyaOnEarth Modmail is first activated, existing conversations are seeded as context without replaying their old participant messages as new behavioural offences. Only messages arriving after that activation boundary enter the normal relay/private-moderation stream.
