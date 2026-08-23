# Mae Reddit

Mae's Reddit service owns Reddit credentials, Reddit API access, Reddit-specific durable state, moderation actions, subreddit migrations, Modmail transport, direct-message handling, private moderation context, and Twitter-to-Reddit presentation.

The active implementation is TypeScript/Bun under `src/`. The retired Python implementation has been moved to `deprecated/legacy-python/` and is preserved only for historical parity checks, migration evidence, and incident archaeology. It must not be launched by production supervisors, shell launchers, cron jobs, or service definitions.

Mae's canonical member reputation state is the TypeScript reputation store. On the production host the established canonical score database is `data/reputation.pb`. Archived Python databases, karma gates, flair logic, and moderation state are not authoritative.

## Current architecture

The TypeScript runtime includes:

- strict TypeScript/Bun CI and architecture-boundary checks;
- typed Reddit OAuth/Data API clients and mutation boundaries;
- persistent protobuf-backed Reddit state through the shared mutex/atomic store;
- canonical Mae reputation, tier, flair, discipline, score high-water, vote-review and notice state;
- deterministic moderation consequences driven by structured semantic classification;
- live moderator exemption before public or private OpenAI moderation calls;
- private Modmail semantic moderation with persistent OpenAI-schema conversation context;
- transport-only Reddit Modmail synchronisation and crash-safe attributed moderator reply outbox;
- Discord and Telegram ordinary Modmail presentation through the authenticated Reddit-owned internal API;
- focused Modmail web terminal with a synthetic read-only preview on loopback port `8892`;
- direct Reddit-message ingestion with a durable first-activation boundary, private semantic moderation, separate persistent Mae conversation context and duplicate-safe delivery recovery;
- cross-platform moderation-review state with first-authorised-moderator-wins semantics;
- Twitter fanout and subreddit presentation integration;
- explicit migration and compatibility tooling for historical state.

These are feature-branch capabilities. They are not considered production-complete until exact-head CI, configuration, deployment and live end-to-end validation have all succeeded.

## Private surfaces

Reddit Modmail and direct messages deliberately have different ownership rules.

### Modmail

- Reddit owns the canonical Modmail conversation and all Reddit mutations.
- Participant messages are semantically audited with durable private context.
- Mae does **not** generate ordinary conversational Modmail replies.
- Human moderators reply through Reddit, Discord, Telegram or a focused terminal.
- Discord/Telegram replies are attributed to the human moderator and queued through one durable Reddit outbox.
- Initial adapter activation skips existing relay history instead of flooding moderator channels.
- Platform-origin metadata suppresses only proven self-echoes.

The focused terminal is loopback-bound by default at:

```text
http://127.0.0.1:8892/
```

Its synthetic, read-only preview is available at:

```text
http://127.0.0.1:8892/preview/
```

No Reddit Modmail conversation is required for the preview. It cannot queue replies. A real short-lived moderator terminal link additionally requires `REDDIT_MODMAIL_WEBAPP_BASE` to point at the HTTPS URL supplied by the deployment reverse proxy.

### Direct messages

- Historic incoming DMs are recorded on first activation and never answered retroactively.
- New incoming DMs use structured private semantic moderation before reputation mutation.
- Clean private messages award zero reputation points.
- Genuine private violations deduct from the same canonical reputation state as public moderation.
- A genuine constructive apology may clear the current temporary communication mute, but never restores reputation or a permanent restriction.
- Canonical moderators and Mae herself are exempt from semantic/reputation mutation before the LLM boundary.
- Moderation and Mae's conversational reply use **separate** managed OpenAI conversation IDs per DM thread.
- Mae's generated reply is persisted before Reddit delivery is attempted.
- If the process crashes after a reply attempt, Mae checks Reddit's sent mailbox for the exact parent message and persisted body before treating it as delivered. An uncertain delivery is blocked rather than blindly resent.

## Ownership

- Reddit owns canonical Reddit state and Reddit mutations.
- Mae's reputation store owns ordinary reputation and desired flair state.
- Twitter ingestion/classification remains owned by `maebot-twitter`.
- Discord and Telegram are presentation and moderator-control adapters, not canonical Reddit stores.
- Reddit must not open Twitter or Telegram canonical stores.
- Human moderators may reply to Reddit Modmail through approved adapters, but Mae does not generate ordinary conversational Modmail replies.
- Direct Reddit DMs are the private surface where Mae may converse as Mae after the private moderation boundary.

See `docs/architecture.md`, `docs/legacy-parity.md`, `docs/state-migration.md`, `docs/flair-migration.md`, `docs/reputation-bootstrap.md` and `docs/twitter-bridge.md` for engineering contracts and migration history.

## Setup

Initialise pinned dependencies recursively, then install with Bun:

```sh
git submodule update --init --recursive
bun install
```

Copy `.env.example` to a deployment-local `.env` and provide the required Reddit and internal-service credentials. Never commit populated credentials.

## Reddit audit

```sh
bun run audit:reddit
```

The default report path is `data/reddit-audit.json`. Pass a path as the first argument to override it.

## Reputation state

The canonical production score store is:

```text
data/reputation.pb
```

The human-readable bootstrap report is kept separately. Bootstrap or migration commands must never overwrite an established canonical store casually. Review state and migration inputs before any forced bootstrap or recovery operation.

## Legacy Python archive

The retired implementation is located at:

```text
deprecated/legacy-python/
```

Read `deprecated/legacy-python/README.md` before inspecting or executing anything there. The archive is not part of the active runtime and must not receive live credentials or canonical production state.

Migration tooling remains active under `src/migration/` and `scripts/`. Those tools may process explicitly supplied historical data without reactivating the Python runtime.

## Legacy state snapshot copy

When historical state needs to be captured for migration analysis, copy it into a new isolated destination:

```sh
bun run scripts/legacySnapshot.ts <legacy-reddit-dir> <new-snapshot-dir> [legacy-common-dir]
```

The source tree is never modified. The command refuses to place the snapshot inside the source tree or overwrite an existing snapshot directory, and writes SHA-256 metadata to `manifest.json`.

## Checks

```sh
bun run ci
```

CI runs strict TypeScript checks, loose-type checks, ownership and architecture-boundary checks, then the full Bun test suite.

For host validation use `scripts/hostCi.sh`. It creates a disposable clone and does not open or copy the production `data/reputation.pb`.

## Production status

This feature branch is still a release candidate, not an instruction to deploy. Exact-head host CI, controlled live integration checks, final state validation, and explicit approval are required before merge or production promotion.
