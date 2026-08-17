# Mae Reddit

Mae's Reddit service owns Reddit credentials, Reddit API access, Reddit-specific durable state, moderation actions, subreddit migrations and Twitter-to-Reddit presentation.

The TypeScript/Bun overhaul is being developed on `agent/ts-overhaul`. The legacy Python processes remain the production writers until parity, migration and live-read validation are complete. The TypeScript entry point therefore does **not** perform live Reddit writes yet.

## Current safe capabilities

- strict TypeScript/Bun project and CI skeleton;
- direct typed Reddit OAuth/Data API read client;
- read-only audit of the legacy `r/catgirlcoin` configuration and the `r/nyaonearth` destination;
- explicit rate-limit/error classification without logging secret-bearing request objects;
- protobuf-backed Reddit state foundation using the shared mutex/atomic store;
- idempotent action and Twitter fanout lifecycle primitives;
- frozen deterministic parity helpers for legacy commands, questions, canned replies, "this is the Mae", moderation signals and haiku syllable corrections;
- copy-only legacy-state snapshot tooling.

## Ownership

- Reddit owns Reddit.
- Twitter ingestion/classification remains owned by `maebot-twitter`.
- Telegram and Discord remain presentation/review adapters.
- Reddit must not open Twitter or Telegram canonical stores.

See `docs/architecture.md`, `docs/legacy-parity.md`, `docs/state-migration.md` and `docs/flair-migration.md` for the current engineering contracts.

## Setup

Initialise pinned dependencies recursively, then install with Bun:

```sh
git submodule update --init --recursive
bun install
```

Copy `.env.example` to a deployment-local `.env` and supply the Reddit script-app credentials. Never commit the populated file.

## Read-only Reddit audit

```sh
bun run audit:reddit
```

The default report path is `data/reddit-audit.json`. Pass a path as the first argument to override it.

This audit reads Reddit data only. It does not create flair, alter submissions, moderate content or change subreddit settings.

## Legacy snapshot copy

Before migration parsing, copy legacy state into a new destination:

```sh
bun run scripts/legacySnapshot.ts <legacy-reddit-dir> <new-snapshot-dir> [legacy-common-dir]
```

The source tree is never modified. The command refuses to place the snapshot inside the legacy Reddit tree or overwrite an existing snapshot directory, and writes SHA-256 metadata to `manifest.json`.

## Checks

```sh
bun run ci
```

CI runs strict TypeScript checks, loose-type and ownership-boundary checks, then the test suite.

## Production status

Do not replace or stop the legacy Python writers from this branch. Live writes, flair migration, Twitter fanout, moderation application and final cutover remain gated on the staged validation plan in the docs.
