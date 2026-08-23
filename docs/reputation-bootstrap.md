# Reddit reputation bootstrap

This is the first-stage migration into Mae's internal Reddit reputation system.

## Purpose

`bun run bootstrap:reputation` performs a read-only Reddit inventory and writes only local migration artefacts:

- `data/reputation.pb` — canonical protobuf-backed reputation state through the existing `Store` / `MutexProtoBuffStore` boundary;
- `data/reputation-bootstrap-report.json` — human-readable audit report.

The command does **not** create, copy, edit or assign Reddit flair templates. Existing live Reddit flair templates are authoritative.

## Inventory

The bootstrap reads the configured source subreddit and records:

- every user flair template returned by Reddit, including its template ID;
- every post flair template returned by Reddit, including its template ID;
- semantic references to the seven tier flair IDs and, where present, Warned, Uncivil, SCAM, `Minor Announcement :lisa:` and `Announcement :catgirl-moon:`;
- the complete moderator listing;
- the complete banned-user listing available to the bot;
- every user flair assignment returned by `/api/flairlist`;
- authors discoverable in Reddit's accessible `/new` post and `/comments` history, up to 1,000 items from each listing.

The seven ordinary tier flair templates are required and the bootstrap fails closed if any is missing or ambiguous. Status/announcement semantic references are reported as unresolved rather than guessed when no unique exact text match exists; the complete raw flair catalog remains in both the report and protobuf state for review.

Reddit does not expose a complete subscriber roster. Therefore users with no flair and no contribution in the accessible listing window cannot be inventoried before they next participate. Runtime contribution ingestion must create those users on their first observed contribution.

## Initial scoring

Existing ordinary flair holders are seeded at the floor of the tier they were manually assigned:

| Existing flair | Tier | Initial points |
| --- | ---: | ---: |
| `:mae:` / `:lisa:` | 1 | 1 |
| `:kita:` / `:aoi:` | 2 | 10 |
| `:hana:` / `:rin:` | 3 | 100 |
| `:celeste:` | 4 | 1000 |

The live tier boundaries are:

- 1–9: tier 1
- 10–99: tier 2
- 100–999: tier 3
- >999: tier 4

An unflair user discovered through an existing contribution is treated as having made their first contribution and is seeded with 1 point. Their tier-one flair choice is selected once and persisted: `:lisa:` has a 1% chance and `:mae:` the remaining 99%. The bootstrap roll is deterministically derived from the subreddit and username so an interrupted pre-persistence bootstrap cannot silently reroll the user on retry. Normal runtime tier transitions will persist the chosen variant when the transition happens.

Moderator accounts are marked as immutable and their current moderator flair is never replaced by tier reconciliation.

Known moderation states are represented independently of positive tiers:

- warned: -1
- uncivil: -2
- permanent ban: -3
- scam/promotion: -4 and permanently banned

Any flair that cannot be mapped confidently is preserved verbatim, seeded at 0, marked `unmapped`, and emitted as `needsReview` rather than guessed.

## Safety

The bootstrap refuses to overwrite an already initialised `reputation.pb` unless `--force` is supplied. `--force` is intended only after the prior report and state have been reviewed.

No Reddit-side flair assignment occurs during bootstrap. Users discovered without a flair are recorded with `needsFlair=true` and the desired existing template ID so a later explicit reconciliation step can apply it safely.

After writing the state, the command reopens/verifies the protobuf bootstrap marker before reporting success.

The reputation store also reserves empty `contributions` and `reputationJournal` maps for the next phase. Vote-score credits and contribution credits must be journalled atomically with user-point changes so retries cannot double-credit users.

## Legacy participation gates

As part of the same migration candidate, the obsolete Reddit-global-karma participation restrictions are retired from the legacy Python moderation oracle. Participation will be governed by Mae's internal moderation/reputation system rather than Reddit account karma.

The automated bot notice also includes a blank paragraph before its Markdown horizontal rule so Reddit does not render the preceding moderation message as a Setext heading.
