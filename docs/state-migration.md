# State migration audit

## Purpose

This document records the durable state visible from source and the production state that must be migrated. Migration is copy-first, rerunnable and auditable. No production store is to be overwritten during discovery.

The first live production inventory was frozen on 17 August 2026 in `docs/production-inventory-2026-08-17.md`.

## Known legacy state

| Legacy datum | Observed source access | Meaning | Target ownership | Migration status |
| --- | --- | --- | --- | --- |
| `warned_users` | comment/community Reddit DB and parent DB reads from submission process | Users escalated to warned/restricted state | Reddit | Active physical source confirmed; values still need snapshot parsing |
| `banned_users` | comment/community Reddit DB and parent DB reads from submission process | Users escalated to banned/uncivil state | Reddit | Active physical source confirmed; values still need snapshot parsing |
| `questions` | comment/community Reddit DB | Reddit submission ID to bot best-answer marker comment ID | Reddit | Active physical source confirmed; values still need snapshot parsing |
| per-submission question records | submission moderation DB | Stored question title/history for similarity | Reddit | Active store confirmed at `submission_moderation/database.db`; values still need snapshot parsing |
| `titm` | comment/community Reddit DB | Global "this is the Mae" count | Reddit community state | Active physical source confirmed; value still needs snapshot parsing |
| `leaderboard` | comment/community Reddit DB | Per-user "this is the Mae" counts | Reddit community state | Active physical source confirmed; values still need snapshot parsing |
| `Haikus` | comment/community Reddit DB | Haiku history keyed by author | Reddit community state | Active physical source confirmed; values still need snapshot parsing |
| `Haikus/` | local filesystem | Historical generated `.haiku` files | Reddit/archive policy | Confirmed: 13 files, about 100K; per-file inventory still required |
| `pairs.csv` | local filesystem | Canned phrase/reply pairs | Reddit typed config/data | Confirmed at `/home/kitty/server/mae/reddit/pairs.csv`, SHA-256 frozen in production inventory |
| special-response cooldown | process memory | Last public canned-response timestamps | Reddit | No durable legacy value to migrate |
| warned/banned flair assignments | Reddit plus local DB | User moderation/reputation presentation | Reddit | Reconcile local state with live Reddit |
| current user flair assignments | `r/catgirlcoin` | Community identity/reputation/flair | Reddit | Live export required |
| post flair templates | `r/catgirlcoin` | Post categorisation semantics | Reddit | Live export required |
| user flair templates | `r/catgirlcoin` | User identity/status semantics | Reddit | Live export required |
| Discord Reddit-question pointer | Discord `MaeDb.questions` | Reddit submission ID to Discord presentation message ID | Discord | Preserve as presentation state |

## Physical stores: resolved production layout

The first production inventory confirmed two live Python processes with different working directories and therefore two distinct relative `database.db` files.

### Comment/community process

- PID at inventory: `2006106`
- CWD: `/home/kitty/server/mae/reddit`
- active store: `/home/kitty/server/mae/reddit/database.db`
- size: `6172` bytes
- SHA-256: `cd6f3fe825d95fe83c7a09a71aa954eb1d570acb1531326b4dc79d4a626d2d19`

### Submission moderation process

- PID at inventory: `2334136`
- CWD: `/home/kitty/server/mae/reddit/submission_moderation`
- active store: `/home/kitty/server/mae/reddit/submission_moderation/database.db`
- size: `4090` bytes
- SHA-256: `8c786e8ca672b4c7be0ae45c83a6aaf9272f231744ffe1843d856e5a6cad3807`

`submission_moderation/main.py` also explicitly opens the parent Reddit database for shared warned/banned state, while helpers in the submission process may open the submission-local database through the current working directory.

Migration tooling must therefore model these as two independently hashed source snapshots. It must not concatenate or merge them mechanically. Each key is mapped according to its legacy semantic owner and access path.

## Legacy copies are evidence, not automatic migration inputs

Additional Reddit database copies were found:

- `/home/kitty/server/mae/reddit/database_backup.db`
- `/home/kitty/server/mae/reddit/database - Copy.db`
- `/home/kitty/server/mae/reddit/submission_moderation/database - Copy.db`

Their hashes and metadata are frozen in the production inventory. They are not canonical migration inputs unless a later semantic comparison proves that production behaviour depends on records absent from the active stores.

## Source intentionally excluded from Git

The repository ignore rules deliberately exclude runtime databases, files matching `database*`, CSVs, `Haikus/`, logs and environment files. Therefore absence from Git is not proof that a production artefact is missing.

`/home/kitty/server/mae/reddit/submission_moderation/database_reduild.py` is now confirmed to exist in production with SHA-256 `d859fdd6795ee0d06550b2861871ca88abfdea62a207deb2c4a13c84a0ab4554`. Its contents and import behaviour still require a read-only audit.

The sibling production dependency `/home/kitty/server/mae/common` is also confirmed. Its `database.py` and `database.db` hashes are frozen in the production inventory. Only the Reddit-relevant API/state surface is in scope.

## Target durable model

Exact protobuf field names remain implementation details until the state and live Reddit audits are complete, but the TypeScript service must have explicit durable records for these logical domains.

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

## Production inventory status

Already confirmed without mutation:

- absolute runtime paths for both live Reddit processes;
- process working directories;
- separate active database paths and hashes;
- presence/hash of `pairs.csv`;
- presence/count/size of `Haikus/`;
- presence/hash of `database_reduild.py`;
- presence/hash of the sibling `common` database module/store;
- absence of a Reddit-named systemd service or tmux session in the initial scan;
- environment variable names only, with no secret values printed.

Still required:

- exact launcher command/parent process for both live Python processes;
- exact virtualenv/interpreter path and dependency versions actually used;
- parsed schema/content of both active Reddit databases;
- read-only contents/behaviour of `database_reduild.py`;
- Reddit-relevant contents/API surface of `/home/kitty/server/mae/common`;
- exact `pairs.csv` configuration;
- per-file Haiku inventory and hashes;
- credential/configuration source location and key names without exposing values;
- live subreddit moderator list/permissions;
- live user/post flair templates and current assignments needed for migration;
- comparison of active stores against old copies only where needed to prove data continuity;
- logs only if required to establish active legacy branches.

For each state store used as a migration input, create a copy or snapshot before parsing it for migration. Preserve timestamps and hashes so migration inputs can be verified later.

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
