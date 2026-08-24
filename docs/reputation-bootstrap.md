# Reddit reputation bootstrap

This is the first-stage migration into Mae's internal Reddit reputation system.

## Purpose

`bun run bootstrap:reputation` inventories the live source subreddit, reconciles discovered ordinary contributors who have no flair onto an existing tier-one flair, and writes the local migration artefacts:

- `data/reputation.pb` — canonical protobuf-backed reputation state through the existing `Store` / `MutexProtoBuffStore` boundary;
- `data/reputation-bootstrap-report.json` — human-readable audit report.

The command never creates or copies Reddit flair templates. Existing live Reddit flair templates and their IDs are authoritative for the source community.

After `reputation.pb` exists, `bun run clone:flairs` is the separate CatgirlCoin → NyaOnEarth community bootstrap. That command explicitly targets NyaOnEarth, clones the source flair templates, builds subreddit-local template-ID mappings, projects the canonical reputation state, clones/reuses sticky posts, and reconciles canonical permanent bans. It does not require the publishing `REDDIT_PRIMARY_SUBREDDIT` to have switched to NyaOnEarth first and it must not reinterpret legacy CSS classes as new moderation decisions.

## Inventory

The reputation bootstrap reads the configured source subreddit and records every user/post flair template, moderator, banned user, flair assignment, and authors discoverable in Reddit's accessible `/new` and `/comments` history, up to 1,000 items from each listing.

For `r/catgirlcoin`, the live reputation-related inventory captured on 23 August 2026 is now recorded in source and validated by exact template ID before bootstrap proceeds:

| Meaning | Template ID | Live text / CSS |
| --- | --- | --- |
| Tier 1 Mae | `c287b8ea-94bc-11ec-ac69-aab48f042082` | `:mae:` / `h` |
| Tier 1 Lisa | `db95e19a-94bc-11ec-b636-d6d9f3ebf86d` | `:lisa:` / `h` |
| Tier 2 Kita | `c9271cd6-94bc-11ec-b2f4-3e0827c16db5` | `:kita:` / `h` |
| Tier 2 Aoi | `e48e5160-94bc-11ec-b456-860cd7017d9e` | `:aoi:` / `h` |
| Tier 3 Hana | `d44f2694-94bc-11ec-a039-eec865a675c1` | `:hana:` / `h` |
| Tier 3 Rin | `e9b4c9f8-94bc-11ec-b636-d6d9f3ebf86d` | `:rin:` / `h` |
| Tier 4 Celeste | `d8018552-94bc-11ec-a4d1-22f06121d139` | `:celeste:` / `h` |
| Tier 5 Pawsome | `a31e3b22-3e55-11ec-bb6b-ceedb0263d7d` | `Pawsome contributor :catgirl-moon:` / `h` |
| Warned | `bc2db8c4-29d5-11ed-a76f-163c4ee499e0` | blank text / `w` |
| Uncivil | `e37b5534-91ce-11ec-84c8-7602fd74d2f2` | blank text / `u` |
| SCAM | `fec5118a-4ff2-11ed-922e-96e4dc818f74` | `SCAM` / `s` |
| Minor Announcement | `a6fef792-9100-11ec-aa84-9a9e4751ff9e` | `Minor Announcement :lisa:` |
| Announcement | `807098b2-3b72-11ec-a37b-aa7cb124a04e` | `Announcement :catgirl-moon:` |

The bootstrap fails closed if any of those recorded `r/catgirlcoin` IDs is absent or if its expected text/CSS semantics have changed. This prevents a renamed or replaced flair from being silently guessed.

Reddit does not expose a complete subscriber roster. Therefore users with no flair and no contribution in the accessible listing window cannot be inventoried before they next participate. Runtime contribution ingestion must create and flair those users on their first observed clean contribution.

## Initial scoring and tiers

Existing ordinary flair holders are seeded from the tier they were manually assigned:

| Existing flair | Tier | Initial points |
| --- | ---: | ---: |
| `:mae:` / `:lisa:` | 1 | 1 |
| `:kita:` / `:aoi:` | 2 | 10 |
| `:hana:` / `:rin:` | 3 | 100 |
| `:celeste:` | 4 | 1000 |
| `Pawsome contributor :catgirl-moon:` | 5 | 9999 |

The positive member boundaries are:

- 1–9: tier 1
- 10–99: tier 2
- 100–999: tier 3
- 1000–9998: tier 4
- 9999: tier 5, Pawsome contributor

9,999 is the hard ceiling for every non-moderator account. Positive participation or vote-score credit must never move a normal user above 9,999.

Moderators are tier 9 and are fixed at 999,999,999 points. That is the moderator ceiling and moderator points cannot increase beyond it. Moderator flair remains immutable and moderator accounts are excluded from LLM moderation together with Mae herself.

An unflair user discovered through an existing contribution is treated as having made their first contribution and is seeded with 1 point. Their tier-one flair choice is selected once and persisted: `:lisa:` has a 1% chance and `:mae:` the remaining 99%. The bootstrap roll is deterministically derived from the subreddit and username so an interrupted pre-persistence bootstrap cannot silently reroll the user on retry.

The bootstrap applies the selected existing tier-one template to every discovered ordinary contributor who has no flair. It refuses to complete if any such discovered user remains marked as requiring a flair.

Known moderation states are represented independently of positive tiers:

- warned: 0 through -3, with negative points represented as Strikes;
- uncivil: -4 through -9, recoverable through clean accepted participation;
- permanent-ban trigger: -10 or lower, immediately clamped to -999,999,999;
- scam/prohibited malicious promotion: immediate -999,999,999 permanent enforcement.

-999,999,999 is the absolute reputation floor and no account can fall below it. Uncivil is not a permanent-ban alias: uncivil users may comment, cannot submit posts, and remain eligible for redemption until they cross the permanent-ban trigger.

Any flair that cannot be mapped confidently is preserved verbatim, seeded at 0, marked `unmapped`, and emitted as `needsReview` rather than guessed.

## Two-community projection

Points, tier, status, moderation history and discipline are canonical per Reddit username and are not duplicated per subreddit. Reddit flair template UUIDs are local implementation identifiers, so the NyaOnEarth bootstrap records a source-template → target-template mapping in `data/flairs.json` and projects the one canonical user state through that mapping.

When moderation is enabled, Mae's moderation and Modmail scope is CatgirlCoin + NyaOnEarth independently of the publishing primary. This permits the live publishing route to remain CatgirlCoin/CatgirlCoin during the protection/bootstrap phase. CatgirlCoin remains the canonical external-effect surface represented directly inside `reputation.pb`; NyaOnEarth owns separate Reddit-local application state in `data/communityProjection.pb`, so a successful CatgirlCoin mute/ban can never falsely mark the target operation complete.

Before the community bootstrap is allowed to mutate NyaOnEarth, the running target projection must already have established a current communication restriction there for every canonical `banned`/`scam` user. The preflight requires both Mae's local projection checkpoint and Reddit's live `/about/muted` relationship to agree. A manually removed target mute is therefore detected rather than hidden by stale local state.

A successfully written schema-2 `data/flairs.json` is the activation marker for ongoing NyaOnEarth ban/flair reconciliation. A missing or older schema-1 catalogue remains pre-bootstrap historical evidence and does not block Mae from running dual-community moderation. Before schema 2 exists, target projection establishes communication restrictions but deliberately does not mass-clone permanent bans or member flairs. After activation, live target moderation relationships are reconciled periodically: communication restrictions first, missing canonical permanent bans second, and local flair assignment on the configured flair cadence.

The publishing/post-mirror cutover is separate. After the bootstrap has been verified, `REDDIT_PRIMARY_SUBREDDIT` may be changed from CatgirlCoin to NyaOnEarth and Mae restarted to activate the normal bidirectional publishing/mirror role.

Post mirroring is moderation-gated. New posts wait until their canonical moderation result exists; content requiring removal is not mirrored; accepted/privileged posts may be mirrored. Mae-created mirror copies are privileged system activity and do not earn a second reputation contribution.

The community bootstrap fails closed when:

- the configured source is not CatgirlCoin;
- the publishing primary is neither the valid pre-bootstrap CatgirlCoin value nor the post-cutover NyaOnEarth value;
- the canonical reputation store is absent;
- Mae lacks required `access`, `flair`, `posts` or `mail` moderator permission in either community;
- any canonical user still requires semantic review;
- live CatgirlCoin bans disagree with canonical `banned`/`scam` state;
- NyaOnEarth contains an unexplained extra ban;
- either the local target mute checkpoint or Reddit's live muted-user relationship is missing for a canonical permanent user;
- a canonical source flair cannot be mapped to exactly one NyaOnEarth template;
- post-bootstrap live mute, flair or ban verification does not match the intended canonical state.

Legacy `database.db` moderation lists and legacy uncivil CSS markers are not migration authority for this step.

## Safety

The reputation bootstrap refuses to overwrite an already initialised `reputation.pb` unless `--force` is supplied. `--force` is intended only after the prior report and state have been reviewed.

Flair reconciliation is limited to discovered ordinary users whose bootstrap record explicitly says they require a tier flair. Moderator and non-ordinary records are rejected by the reconciliation boundary rather than modified.

After writing the state, the command reopens/verifies the protobuf bootstrap marker before reporting success.

The reputation store also reserves `contributions` and `reputationJournal` maps for runtime state. Vote-score credits and contribution credits are journalled atomically with user-point changes so retries cannot double-credit users. Point mutations clamp normal members to 9,999, moderators to 999,999,999, and everybody to the -999,999,999 floor.

## Legacy participation gates

As part of the same migration candidate, the obsolete Reddit-global-karma participation restrictions are retired from the legacy Python moderation oracle. Participation is governed by Mae's internal moderation/reputation system rather than Reddit account karma.

The automated bot notice also includes a blank paragraph before its Markdown horizontal rule so Reddit does not render the preceding moderation message as a Setext heading.
