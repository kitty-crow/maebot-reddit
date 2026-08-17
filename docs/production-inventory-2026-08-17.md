# Production Reddit inventory — 17 August 2026

## Scope

This is a read-only snapshot of the deployed legacy Reddit runtime reported from the production host on 17 August 2026. No process or state was changed while collecting it.

The purpose is to resolve the physical-state ambiguities identified by the source audit before any TypeScript/Bun migration is implemented.

## Confirmed running processes

Two independent legacy Python processes are live:

| Role inferred from CWD | PID at inventory time | Executable | Working directory | Python environment |
| --- | ---: | --- | --- | --- |
| comment/community bot | `2006106` | `python` | `/home/kitty/server/mae/reddit` | virtualenv present |
| submission moderation bot | `2334136` | `python` | `/home/kitty/server/mae/reddit/submission_moderation` | virtualenv present |

The first environment-name inventory filtered only conventional prefixes such as `REDDIT_*`, `CATGIRL_*` and `MAE_*`, so it did not show the credential variables used by the legacy Python source.

The checked-in legacy source establishes the actual credential arrangement without revealing secret values:

- Reddit OAuth client ID is a hard-coded public client identifier;
- the OAuth client secret is read from an environment variable whose **name is the client ID itself**;
- the Reddit username is hard-coded as `this_is_the_mae`;
- the Reddit password is read from an environment variable named `this_is_the_mae`.

Therefore the absence of `REDDIT_*` variables in the first shell inventory does **not** imply file-based or hard-coded secrets. The TypeScript replacement will deliberately normalise these to conventional deployment-local names such as `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME` and `REDDIT_PASSWORD`; no real secret value is to be copied into Git or audit output.

No Reddit-specific tmux session and no matching systemd service were found. Existing relevant tmux sessions were:

- `mae-discord`
- `mae-telegram`
- `mae-twitter`

The legacy Reddit launch mechanism therefore remains unresolved and must be identified before cutover/restart planning.

## Confirmed active state files

The process working directories resolve the previously ambiguous relative `database.db` references to two distinct live stores.

### Comment/community bot store

`/home/kitty/server/mae/reddit/database.db`

- size: `6172` bytes
- mtime: `2026-05-11 21:18:26.869684383 +0100`
- SHA-256: `cd6f3fe825d95fe83c7a09a71aa954eb1d570acb1531326b4dc79d4a626d2d19`

This is the physical store used by code opening `database.db` from `/home/kitty/server/mae/reddit`.

### Submission moderation store

`/home/kitty/server/mae/reddit/submission_moderation/database.db`

- size: `4090` bytes
- mtime: `2026-08-09 06:27:59.161433787 +0100`
- SHA-256: `8c786e8ca672b4c7be0ae45c83a6aaf9272f231744ffe1843d856e5a6cad3807`

This is the physical store used by code opening `database.db` from `/home/kitty/server/mae/reddit/submission_moderation`.

The two stores must be migrated independently and semantically merged only where the source behaviour proves that they represent the same logical domain.

## Additional Reddit state and legacy copies

| Path | Size | mtime | SHA-256 / status |
| --- | ---: | --- | --- |
| `/home/kitty/server/mae/reddit/database_backup.db` | `6675` B | 2023-04-02 | `50db4b3f2811495f3d6e54d04a4721bec30e02556f3abf3cb2143a2a24f97d9d` |
| `/home/kitty/server/mae/reddit/database - Copy.db` | `6824` B | 2023-06-19 | `371b8c2a0c67cb7d756a663a151ac78af411da00f47995e0bb3f5b5b2405b6cb` |
| `/home/kitty/server/mae/reddit/submission_moderation/database - Copy.db` | `3030` B | 2023-06-19 | `114cb7244ac789756c259dcbd80b7c7561cbcf345abeb8c752bc4c9a12aa1eea` |
| `/home/kitty/server/mae/reddit/pairs.csv` | `190` B | 2022-02-28 | `5ae97d1494e9a16782289eac7a1ac45d9e6a905f2cbc6c32e122fe7a7eaf7c55` |
| `/home/kitty/server/mae/reddit/Haikus/` | 13 files / about `100K` | n/a | directory inventory required |

The old backup/copy databases are evidence and possible rollback/reference material. They are not canonical migration inputs unless a semantic audit proves that the active store lost data that production behaviour still depends on.

## Previously missing production module confirmed

`/home/kitty/server/mae/reddit/submission_moderation/database_reduild.py` exists in production.

- size: `647` bytes
- mtime: `2022-10-01 13:24:55.240517000 +0100`
- SHA-256: `d859fdd6795ee0d06550b2861871ca88abfdea62a207deb2c4a13c84a0ab4554`

Its absence from Git is explained by the source-only ignore rule matching `database*`. Its contents and actual import behaviour must be audited read-only before the TypeScript replacement is specified.

## Shared `common` dependency confirmed

The legacy sibling dependency exists at `/home/kitty/server/mae/common`.

### `/home/kitty/server/mae/common/database.db`

- size: `656` bytes
- mtime: `2023-08-26 12:35:37.445745039 +0100`
- SHA-256: `0dcf90dcc679b7d00cbdf16ac02de25052dd1726e7b5bd3095ac121a5ca69d19`

### `/home/kitty/server/mae/common/database.py`

- size: `6388` bytes
- mtime: `2023-08-26 12:38:18.873531607 +0100`
- SHA-256: `0a08ffac6486e8437e0db0a6b93c023e7c85e641cbc06ed31324c6b073b472e8`

The `common` directory is therefore a real production dependency, not a stale import assumption. Its Reddit-relevant API surface must be frozen before implementation of the legacy-state parser.

## Unrelated database artefacts

The host also contains database files under `/home/kitty/server/mae/clock`, `/home/kitty/server/mae/` and `/home/kitty/pythonClasses/`. Nothing in the current audit proves that these are Reddit migration inputs. They must not be folded into the Reddit migration merely because of their names.

In particular:

- `/home/kitty/server/mae/database.db` is only 2 bytes and dates to 2023;
- `/home/kitty/server/mae/clock/database.db` and its backup are 16 bytes;
- `/home/kitty/pythonClasses/database.py` is outside the deployed Reddit tree.

They remain out of scope unless a subsequent import/runtime trace proves otherwise.

## Resolved source-audit questions

The inventory resolves these earlier unknowns:

1. **There are two running Reddit Python processes.**
2. **They have different working directories.**
3. **They therefore use different relative `database.db` files.**
4. **`submission_moderation/database_reduild.py` exists in production.**
5. **The sibling `common` directory exists in production.**
6. **`pairs.csv` exists and has a stable source hash.**
7. **`Haikus/` exists with 13 files.**
8. **Reddit is not visibly managed by a Reddit-named tmux session or systemd service.**
9. **The legacy credential variable names are known from source, without exposing their values.**

## Still required before migration code that parses legacy state

The following discovery remains read-only:

- exact command lines and parent process/launcher for both running Python processes;
- exact virtualenv/interpreter paths and dependency versions actually used;
- contents/schema of both active Reddit `database.db` files;
- contents and behaviour of `database_reduild.py`;
- Reddit-relevant contents/API surface of `/home/kitty/server/mae/common`;
- contents of `pairs.csv`;
- names/hashes and semantic role of the 13 `Haikus/` files;
- live subreddit moderator list and permissions;
- live user/post flair templates and current assignments required for migration;
- whether the old database copies contain still-relevant records absent from the active stores;
- current logs only if necessary to establish which branches of legacy behaviour are active.

## Migration consequence

The target TypeScript/Bun service must not assume a single legacy database. The migration should treat the active comment/community store and active submission-moderation store as two separately hashed source snapshots, then transform them into explicit typed domains in the new protobuf state.

The final migration manifest must carry both source path and source SHA-256 for every imported record so reruns and rollback validation can prove which production snapshot produced the new state.
