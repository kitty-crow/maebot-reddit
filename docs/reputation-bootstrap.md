# Reddit reputation bootstrap

This is the first-stage migration into Mae's internal Reddit reputation system.

## Purpose

`bun run bootstrap:reputation` inventories the live subreddit, reconciles discovered ordinary contributors who have no flair onto an existing tier-one flair, and writes the local migration artefacts:

- `data/reputation.pb` — canonical protobuf-backed reputation state through the existing `Store` / `MutexProtoBuffStore` boundary;
- `data/reputation-bootstrap-report.json` — human-readable audit report.

The command never creates or copies Reddit flair templates. Existing live Reddit flair templates and their IDs are authoritative.

## Inventory

The bootstrap reads the configured source subreddit and records:

- every user flair template returned by Reddit, including its template ID;
- every post flair template returned by Reddit, including its template ID;
- semantic references to the ordinary tier flair IDs, including `Pawsome Contributor`, and where present Warned, Uncivil, SCAM, `Minor Announcement :lisa:` and `Announcement :catgirl-moon:`;
- the complete moderator listing;
- the complete banned-user listing available to the bot;
- every user flair assignment returned by `/api/flairlist`;
- authors discoverable in Reddit's accessible `/new` post and `/comments` history, up to 1,000 items from each listing.

The ordinary tier flair templates are required and the bootstrap fails closed if any is missing or ambiguous. Status/announcement semantic references are reported as unresolved rather than guessed when no unique exact text match exists; the complete raw flair catalog remains in both the report and protobuf state for review.

Reddit does not expose a complete subscriber roster. Therefore users with no flair and no contribution in the accessible listing window cannot be inventoried before they next participate. Runtime contribution ingestion must create and flair those users on their first observed clean contribution.

## Initial scoring and tiers

Existing ordinary flair holders are seeded from the tier they were manually assigned:

| Existing flair | Tier | Initial points |
| --- | ---: | ---: |
| `:mae:` / `:lisa:` | 1 | 1 |
| `:kita:` / `:aoi:` | 2 | 10 |
| `:hana:` / `:rin:` | 3 | 100 |
| `:celeste:` | 4 | 1000 |
| `Pawsome Contributor` | 5 | 9999 |

The positive member boundaries are:

- 1–9: tier 1
- 10–99: tier 2
- 100–999: tier 3
- 1000–9998: tier 4
- 9999: tier 5, `Pawsome Contributor`

9,999 is the hard ceiling for every non-moderator account. Positive participation or vote-score credit must never move a normal user above 9,999.

Moderators are tier 9 and are fixed at 999,999,999 points. That is the moderator ceiling and moderator points cannot increase beyond it. Moderator flair remains immutable and moderator accounts are excluded from LLM moderation together with Mae herself.

An unflair user discovered through an existing contribution is treated as having made their first contribution and is seeded with 1 point. Their tier-one flair choice is selected once and persisted: `:lisa:` has a 1% chance and `:mae:` the remaining 99%. The bootstrap roll is deterministically derived from the subreddit and username so an interrupted pre-persistence bootstrap cannot silently reroll the user on retry.

The bootstrap applies the selected existing tier-one template to every discovered ordinary contributor who has no flair. It refuses to complete if any such discovered user remains marked as requiring a flair.

Known moderation states are represented independently of positive tiers:

- warned: -1
- uncivil: -2
- permanent ban: -999,999,999
- scam/promotion: -999,999,999 and permanently banned

-999,999,999 is the absolute reputation floor and no account can fall below it.

Any flair that cannot be mapped confidently is preserved verbatim, seeded at 0, marked `unmapped`, and emitted as `needsReview` rather than guessed.

## Safety

The bootstrap refuses to overwrite an already initialised `reputation.pb` unless `--force` is supplied. `--force` is intended only after the prior report and state have been reviewed.

Flair reconciliation is limited to discovered ordinary users whose bootstrap record explicitly says they require a tier flair. Moderator and non-ordinary records are rejected by the reconciliation boundary rather than modified.

After writing the state, the command reopens/verifies the protobuf bootstrap marker before reporting success.

The reputation store also reserves empty `contributions` and `reputationJournal` maps for the next phase. Vote-score credits and contribution credits must be journalled atomically with user-point changes so retries cannot double-credit users. Point mutations must clamp normal members to 9,999, moderators to 999,999,999, and everybody to the -999,999,999 floor.

## Legacy participation gates

As part of the same migration candidate, the obsolete Reddit-global-karma participation restrictions are retired from the legacy Python moderation oracle. Participation will be governed by Mae's internal moderation/reputation system rather than Reddit account karma.

The automated bot notice also includes a blank paragraph before its Markdown horizontal rule so Reddit does not render the preceding moderation message as a Setext heading.
