# Target architecture

## Ownership

The Mae platform boundary is strict:

- `maebot-twitter` owns Twitter ingestion, canonical tweet state and Twitter-specific classification/preparation.
- `maebot-reddit` owns Reddit OAuth, Reddit API traffic, Reddit state, Reddit moderation, Reddit flair, Reddit migrations and Reddit external side effects.
- `maebot-telegram` owns Telegram presentation and currently owns the canonical shared Daily Task review store/application flow.
- `maebot-discord` owns Discord presentation and participates in shared review workflows.

A vendored dependency is not permission to open another service's canonical store.

## Current boundary findings

### Twitter

The canonical Twitter service already exposes the correct adapter pattern through an authenticated loopback client:

- read pending work for a platform;
- render/send platform-native output;
- acknowledge successful/recovered delivery;
- prepare or attach canonical review state through the Twitter service.

The current `TwitterPlatform` domain supports only `telegram` and `discord`, with durable per-platform completion/message fields. Reddit therefore requires an explicit cross-repository contract/schema change.

That change must not make existing historical tweets newly pending. The migration must establish a registration epoch/watermark or mark pre-registration history complete for the new consumer while leaving newly observed tweets pending for `reddit`.

Reddit must never:

- instantiate FxTwitter;
- parse FxTwitter responses;
- open `twitter.pb`;
- seed Twitter history independently;
- rerun Twitter worthiness classification;
- generate a competing Twitter Daily Task draft.

### Telegram/Discord Daily Task review

The current shared review store contains:

- one stable review key;
- separate Telegram and Discord message pointers;
- one atomic first-wins decision;
- an applied revision;
- lifecycle queries for unresolved, decided and approved-but-not-applied work.

Message pointers are presentation state, not the decision itself. Existing recovery code can repair a stale platform pointer without changing the canonical decision.

Reddit must not open `dailyReview.pb`. For Reddit pinning after an approved Twitter-derived Daily Task, expose the smallest stable authenticated decision/read boundary or extract a generic typed review contract. Reddit only needs enough canonical information to determine that a specific Twitter review was approved/rejected and whether the relevant revision is current.

### Discord's existing Reddit relay

Discord currently violates the target ownership boundary by owning Reddit credentials and running an active Reddit polling client.

The active relay:

- polls subreddit comments every 15 seconds;
- detects accepted-question marker comments;
- posts a question announcement to a Discord channel;
- stores a Discord message pointer keyed by Reddit submission ID;
- detects `!thankyou` resolution and changes the Discord presentation.

Preserve the user-facing result, but move Reddit observation into `maebot-reddit`.

Target shape:

1. Reddit observes and owns the canonical Reddit question state.
2. Reddit exposes a typed event/read contract for question-opened and question-resolved/best-answer state.
3. Discord consumes it and owns only the Discord message/reaction presentation pointer.
4. Discord no longer has Reddit OAuth credentials, a Reddit password, a static Reddit moderator list or direct Reddit polling.

## Reddit service layout

The exact tree may evolve, but responsibilities should remain separated approximately as follows:

```text
src/
  main.ts
  env.ts
  reddit/
    auth.ts
    client.ts
    errors.ts
    rateLimit.ts
    comments.ts
    submissions.ts
    crossposts.ts
    moderation.ts
    flair.ts
    sticky.ts
  state/
    codecs.ts
    store.ts
    migration.ts
    journal.ts
    audit.ts
  community/
    questions.ts
    bestAnswer.ts
    canned.ts
    maeCount.ts
    leaderboard.ts
    haiku.ts
  mod/
    signals.ts
    reputation.ts
    classifier.ts
    plan.ts
    review.ts
    reversible.ts
  twitter/
    client.ts
    fanout.ts
    presentation.ts
    dailyTask.ts
  flair/
    audit.ts
    mapping.ts
    migrate.ts
  api/
    server.ts
    contracts.ts
scripts/
  audit-runtime.ts
  audit-reddit.ts
  migrate-state.ts
  migrate-flair.ts
  verify.ts
test/
  parity/
  architecture/
  state/
  reddit/
  moderation/
  integration/
```

Avoid a giant `main.ts`. The process entry point should compose services and lifecycle only.

## Reddit API boundary

Prefer a small direct typed HTTP/OAuth client unless current Reddit API constraints justify a maintained library.

The client boundary must provide:

- validated decoding of external JSON;
- token refresh/reauthentication;
- current rate-limit handling;
- bounded retry/backoff with jitter;
- explicit error classes for retryable, authentication, permission, not-found, already-in-state and permanent request failures;
- sanitised diagnostics with no raw bearer/client credentials;
- transport mocking for contract tests.

All current Reddit API capabilities and OAuth requirements must be verified against current Reddit documentation before implementation.

## Canonical Reddit state and side-effect journal

Every external write must have a durable logical identity before the write occurs.

Examples:

- post canonical tweet T to `r/nyaonearth`;
- crosspost T to `r/catgirlcoin`;
- remove Reddit thing ID under policy revision R;
- apply migrated flair F to user U;
- pin the existing tweet-derived Reddit post for approved review revision R.

Lifecycle state must distinguish at least:

- historical/completed;
- pending;
- unresolved/reviewing;
- retryable failure;
- permanent/blocked failure;
- rejected/cancelled;
- externally applied but awaiting local reconciliation.

A missing message/post pointer must never be treated as proof that historical work is pending.

## Twitter-to-Reddit fanout

For each new official `@NyaOnEarth` tweet:

1. obtain the canonical pending Twitter item through the Twitter service;
2. create/recover one Reddit fanout record keyed by tweet ID;
3. post the primary Reddit representation to `r/nyaonearth`;
4. persist/reconcile the primary side effect;
5. create a native crosspost to `r/catgirlcoin` where supported, otherwise use a deliberate linked fallback;
6. persist/reconcile the secondary side effect independently;
7. only after both required subreddit deliveries are complete, acknowledge the Twitter service for platform `reddit`.

A crash after step 4 must resume at step 5 without duplicating the primary post.

Tweet presentation should preserve useful text, media, link, quote context and poll context where the Reddit API supports a good native representation.

No comment mirroring is permitted between the two subreddits.

## Daily Task integration

Reddit has no independent Daily Task scheduler and does not generate Daily Task proposals.

Every official tweet is posted to Reddit regardless of worthiness.

When the canonical Twitter review is approved:

- locate the already-existing Reddit posts for that tweet;
- request desired pin state for each subreddit;
- inspect current sticky slots before applying;
- never evict an unrelated important sticky blindly;
- persist pin results independently;
- make duplicate approval/recovery callbacks harmless.

When rejected:

- leave the ordinary Reddit posts intact;
- do not pin them;
- do not create or delete an extra Reddit post.

## Reddit moderation review

A significant/uncertain Reddit moderation case belongs canonically to Reddit/shared decision state, while Telegram and Discord are review UIs.

Required flow:

1. Reddit creates one canonical case and stable review key.
2. Telegram and Discord adapters render the same case.
3. First valid moderator decision wins atomically.
4. Persist the decision before applying the Reddit action.
5. Reddit alone executes the Reddit action.
6. Persist application/reconciliation state.
7. Both presentation adapters sync to the resolved state.
8. Later duplicate callbacks observe the existing decision and cannot overwrite it.
9. Restart resumes incomplete application without reopening resolved history.

For reversible actions, capture old state before mutation.

## Community question integration

Question/help remains a Reddit-owned community feature.

Reddit should publish a small typed read/event contract for adapters. At minimum, Discord needs:

- Reddit submission ID;
- subreddit;
- title;
- author;
- permalink;
- accepted/open timestamp;
- current resolved/best-answer status and revision.

Discord may keep a durable mapping from Reddit submission ID to Discord message ID so stale/missing presentation pointers can be repaired without changing canonical Reddit question state.

## Submodules and cross-repository changes

Pinned vendored dependencies remain acceptable, but cross-repository contracts must be changed explicitly and tested on both sides.

Expected later changes include:

1. `maebot-twitter`: add the `reddit` consumer to the canonical adapter contract with safe historical migration semantics.
2. `maebot-reddit`: pin and consume the Twitter contract/client without opening Twitter persistence.
3. shared Daily Task review boundary: expose a stable authenticated read/event contract or extract the minimum generic typed contract needed by Reddit.
4. `maebot-discord`: replace direct Reddit OAuth/polling with the Reddit service contract and remove Reddit credentials/static moderator configuration once cutover is proven.
5. `maebot-telegram`/`maebot-discord`: later add Reddit moderation review presentation through a generic typed case contract, without either platform executing Reddit actions.

Do not make these changes until the frozen production/runtime and subreddit audits are complete enough to define migration compatibility.

## Testing gates

`bun run ci` should ultimately gate:

- strict typecheck;
- no loose application types;
- TypeScript-only target implementation;
- architecture boundary checks;
- legacy parity fixtures;
- state/flair migration tests;
- Reddit transport contract tests;
- restart/idempotency failure-point tests;
- Twitter fanout/replay tests;
- Daily Task approval/rejection pin tests;
- cross-platform first-wins review tests;
- no crosspost/comment-loop tests;
- secret/config leakage checks;
- pinned submodule reproducibility.

Promotion remains feature branch -> zero behind current `main` -> full CI -> fast-forward-only `main` -> production `pull --ff-only` -> recursive submodule update -> restart -> smoke -> state/external-effect verification.
