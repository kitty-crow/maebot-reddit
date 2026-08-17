# State migration audit

## Purpose

This document records the durable state visible from source and the production-only state that must be located before migration. Migration is copy-first, rerunnable and auditable. No production store is to be overwritten during discovery.

## Known legacy state

| Legacy datum | Observed source access | Meaning | Target ownership | Migration status |
| --- | --- | --- | --- | --- |
| `warned_users` | legacy Reddit database | Users escalated to warned/restricted state | Reddit | Production values required |
| `banned_users` | legacy Reddit database | Users escalated to banned/uncivil state | Reddit | Production values required |
| `questions` | legacy Reddit database | Reddit submission ID to bot best-answer marker comment ID | Reddit | Production values required |
| per-submission question records | submission moderation database | Stored question title/history for similarity | Reddit | Physical store/path unresolved |
| `titm` | legacy Reddit database | Global "this is the Mae" count | Reddit community state | Production value required |
| `leaderboard` | legacy Reddit database | Per-user "this is the Mae" counts | Reddit community state | Production value required |
| `Haikus` | legacy Reddit database | Haiku history keyed by author | Reddit community state | Production value required |
| `Haikus/` | local filesystem | Historical generated `.haiku` files | Reddit/archive policy | Production inventory required |
| `pairs.csv` | local filesystem | Canned phrase/reply pairs | Reddit typed config/data | Production file required |
| special-response cooldown | process memory | Last public canned-response timestamps | Reddit | No durable legacy value to migrate |
| warned/banned flair assignments | Reddit plus local DB | User moderation/reputation presentation | Reddit | Reconcile local state with live Reddit |
| current user flair assignments | `r/catgirlcoin` | Community identity/reputation/flair | Reddit | Live export required |
| post flair templates | `r/catgirlcoin` | Post categorisation semantics | Reddit | Live export required |
| user flair templates | `r/catgirlcoin` | User identity/status semantics | Reddit | Live export required |
| Discord Reddit-question pointer | Discord `MaeDb.questions` | Reddit submission ID to Discord presentation message ID | Discord | Preserve as presentation state |

## Physical-store ambiguity

The imported source does not prove that all references to `database.db` are the same file.

- The main comment bot and helpers open `database.db` relative to their process working directory.
- `submission_moderation/main.py` explicitly opens a database in the parent directory for warned/banned state.
- `submission_moderation/post_moderation.py` opens `database.db` relative to its process working directory.

The production launcher inventory must therefore capture each process working directory and resolve every database path to an absolute path before any migration tooling is written.

## Source intentionally excluded from Git

The repository ignore rules deliberately exclude runtime databases, files matching `database*`, CSVs, `Haikus/`, logs and environment files. Therefore absence from Git is not proof that a production artefact is missing.

In particular, `submission_moderation/main.py` imports `database_reduild`. Because the ignore rules exclude `database*`, the production audit must check whether that module exists alongside the deployed bot and record its behaviour without modifying it.

The sibling `common` directory imported by legacy code is also outside this repository and must be inventoried.

## Target durable model

Exact protobuf field names remain implementation details until the production audit is complete, but the TypeScript service must have explicit durable records for these logical domains.

### Reddit object processing

Per Reddit thing or logical operation:

- Reddit thing ID;
- object kind;
- source subreddit;
- first-seen timestamp;
- processing lifecycle state;
- policy revision;
- planned action;
- action idempotency key;
- external application state;
- prior state needed for reversal;
- moderator review key where applicable;
- failure classification and bounded retry metadata;
- audit history.

Historical/completed records must never become pending work merely because a platform pointer is absent.

### Twitter-to-Reddit fanout

Per canonical tweet:

- tweet ID;
- canonical source URL and timestamp;
- primary `r/nyaonearth` submission ID/state;
- secondary `r/catgirlcoin` native-crosspost or fallback submission ID/state;
- independent retry/application state for each community;
- Daily Task worthiness/reference from canonical Twitter state;
- canonical review key when applicable;
- pin desired/applied state independently per subreddit;
- final acknowledgement state back to the Twitter service.

Suggested logical side-effect keys include:

- `twitter:<tweetId>:reddit:nyaonearth:post`
- `twitter:<tweetId>:reddit:catgirlcoin:crosspost`
- `twitter:<tweetId>:reddit:nyaonearth:pin:<reviewRevision>`
- `twitter:<tweetId>:reddit:catgirlcoin:pin:<reviewRevision>`

The exact string format may change, but the same logical action must always resolve to the same durable identity.

### User/community state

- migrated flair logical identity;
- warned/restricted state;
- banned/uncivil state;
- prior moderation cases;
- current moderator override where applicable;
- community/reputation observations only after policy design is complete.

Legacy explicit ban/restriction state must not be dropped during schema cleanup.

### Community features

- question records and normalised content;
- best-answer marker/current answer state;
- `!remove` action journal where needed for restart safety;
- global "this is the Mae" count;
- per-user leaderboard;
- canned-response configuration and durable cooldowns if retained;
- haiku history/deduplication;
- any additional state discovered in production.

## Cross-platform state boundary

### Discord Reddit question relay

Discord currently stores a mapping from Reddit submission ID to Discord message ID. This is presentation state and should remain Discord-owned.

The target integration should replace Discord's direct Reddit polling with typed Reddit-owned events or a small authenticated read API such as:

- question opened/accepted;
- question resolved/best answer selected;
- stable Reddit submission identity and permalink.

Discord may continue to store its own message pointer. Reddit must not open Discord stores, and Discord must no longer require Reddit credentials.

### Daily Task review

The current shared Daily Task review state is implemented in Telegram and includes an atomic first-wins decision plus separate Telegram and Discord presentation pointers. Reddit must not open `dailyReview.pb`.

The integration must expose the smallest stable decision boundary needed for Reddit to observe a canonical Twitter review result and pin the already-existing Reddit posts. A loopback authenticated API or an extracted generic typed review contract are acceptable directions. Ownership must not move accidentally into Reddit, Discord or Twitter.

## Twitter consumer migration requirement

The canonical Twitter service currently supports `telegram` and `discord` delivery state. Adding Reddit is a schema/lifecycle change, not merely a TypeScript union edit.

The migration must ensure pre-existing historical tweets do not become fresh Reddit work. Acceptable designs include a consumer registration epoch/watermark or a schema migration that marks all pre-registration history complete for the new `reddit` consumer while allowing newly observed tweets to be pending.

Only after Reddit has durably completed both required subreddit deliveries should it acknowledge the canonical Twitter item for platform `reddit`.

## Production inventory requirements

For every deployed Reddit process, record without mutation:

- absolute checkout/runtime path;
- current Git/source revision if available;
- process manager and launcher command;
- process working directory;
- Python environment/dependency source;
- absolute paths for every database;
- absolute path and hash/size for `pairs.csv`;
- absolute path and count/size for `Haikus/`;
- location and source role of the sibling `common` directory;
- presence and source hash of `database_reduild` or similarly named modules;
- environment variable names used, without printing secret values;
- Reddit username/client identity metadata without secret values;
- current logs only where required to establish active wiring.

For each discovered state store, create a copy or snapshot before parsing it for migration. Preserve timestamps and hashes so migration inputs can be verified later.

## Migration manifest fields

Every legacy datum migrated must eventually have a manifest row containing:

- old absolute path/store;
- old key/type/shape;
- semantic meaning;
- whether retained, transformed or intentionally retired;
- target protobuf/store field or logical record;
- deterministic migration rule;
- idempotency key;
- source hash/snapshot identifier;
- verification method;
- rollback implication.

## Cutover safety

The final cutover must not run while old Python writers are still mutating the same source state. The intended order is:

1. complete read-only and shadow validation;
2. take a final rollback snapshot;
3. stop old Python writers;
4. take/freeze the final migration input;
5. run deterministic migration;
6. verify counts and semantic spot checks;
7. start the TypeScript/Bun Reddit service;
8. run controlled smoke checks;
9. retain the rollback snapshot until the new service is proven stable.
