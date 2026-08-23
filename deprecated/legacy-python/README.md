# Deprecated legacy Python Mae Reddit implementation

Archived: 23 August 2026

This directory contains the retired Python implementation of Mae Reddit. It is preserved for historical parity checks, migration evidence, and incident archaeology only.

## Do not run this code

The active Mae Reddit runtime is the TypeScript/Bun implementation under `src/`, started through the repository's Bun scripts. Files in this directory are not part of the active runtime and must not be launched by production supervisors, shell launchers, cron jobs, or service definitions.

In particular, do not launch `main.py`, `redditbot.py`, or `submission_moderation/main.py`. The latter had already been made inert before archival as a cutover safeguard.

## Canonical state

The retired Python databases, karma gates, flair logic, and moderation state are not authoritative. Mae's canonical member reputation is the TypeScript reputation store. On the production host the established canonical score database is `data/reputation.pb`.

Never rebuild, replace, or reinterpret canonical reputation state from this archived implementation unless performing an explicitly reviewed recovery or migration procedure.

## Why this source remains

The source is retained so maintainers can:

- compare historical behaviour while completing migration and parity work;
- understand old moderation and community features during incident investigation;
- reproduce old behaviour in an isolated environment when deliberately necessary;
- inspect historical Python dependency manifests.

The Python dependency files in this directory are archival for the same reason. They are not production dependency manifests.

## Active migration tooling

TypeScript migration and compatibility tools remain outside this directory, including `src/migration/` and the relevant scripts under `scripts/`. Those tools may inspect historical data, but they do not make this Python runtime active again.

## Safety boundary

Active TypeScript code must not import from this directory. Archived code must not be given live credentials or pointed at canonical production state. If historical code needs to be executed for investigation, do so only in an isolated disposable environment with explicitly prepared test data.
