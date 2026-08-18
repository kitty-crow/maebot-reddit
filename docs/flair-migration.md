# Flair migration audit

## Direction

Flair migration is one-way configuration/state migration from the established legacy community to the new primary community:

- source: `r/catgirlcoin`
- destination: `r/nyaonearth`

`r/nyaonearth` is not to be reverse-engineered as if it already had a mature flair system. The authoritative inventory must be exported from `r/catgirlcoin`.

## Required migration surface

The live source audit must export:

### User flair templates

- source Reddit template ID;
- displayed text;
- CSS class where present;
- text colour;
- background colour;
- user-editable flag;
- mod-only/restricted semantics where exposed;
- any rich-text/emote representation supported by the current API;
- assignment count;
- semantic notes.

### User flair assignments

For each relevant account:

- username;
- source template ID;
- displayed text;
- source CSS class;
- derived logical flair identity after mapping;
- current warned/banned status from legacy local state where applicable.

### Post flair templates

- source Reddit template ID;
- displayed text;
- CSS class where present;
- text/background colour;
- mod-only flag;
- user-editable flag;
- semantic notes;
- representative usage counts where practical.

## Semantics already visible in legacy source

The imported Python code provides evidence for several semantic categories, but live Reddit configuration remains authoritative for the full inventory.

### User status semantics

- warned/restricted users are represented by legacy CSS class `w` and persisted `warned_users` state;
- banned/uncivil users are represented by legacy CSS classes including `u` and `s` and persisted `banned_users` state;
- ordinary community/user identity flairs are also used as a participation gate by the old bot.

The new architecture must migrate the meaning of these states, not preserve CSS classes or template UUIDs as domain identifiers.

### Post semantics

- `Question` is a meaningful post category that activates the question/help workflow;
- the legacy question-cleaning path can move invalidly formatted question posts to a different hard-coded template;
- an NSFW helper exists that can change post flair, but its production wiring is not yet proven.

The full post-flair taxonomy must come from the live `r/catgirlcoin` export before final logical IDs are defined.

## Template IDs are not portable

Reddit flair template IDs are subreddit-specific implementation identifiers. They must never be copied from `r/catgirlcoin` into `r/nyaonearth` as though they identify the same object.

The migration journal must record:

`catgirlcoinTemplateId -> logicalId -> nyaonearthTemplateId`

Logical IDs must be stable domain identifiers derived only after the source inventory is known. Examples in planning documents such as `user:status:warned` or `post:question` illustrate the shape only and are not final inventory decisions.

## User assignment migration

For each source user assignment that maps to a retained logical flair:

1. resolve the source template to a logical ID;
2. resolve the logical ID to the newly created `r/nyaonearth` template;
3. inspect the current destination assignment before writing;
4. apply the target flair only when needed;
5. persist the migration action/result using a deterministic key;
6. classify deleted/suspended/unavailable users separately from failures;
7. verify the final destination assignment.

Suggested logical action identity:

`flair:user:<lowercaseUsername>:<logicalFlairId>:nyaonearth`

The exact format may change, but rerunning the migration must converge without duplicate or conflicting writes.

## Moderation status reconciliation

The legacy local `warned_users`/`banned_users` state and the live source flair assignment are two evidence sources that may disagree.

The migration must report mismatches rather than silently choosing one. Explicit legacy banned/uncivil state must not be lost merely because a visible flair was later changed or removed.

The final moderation/reputation schema should retain status independently of cosmetic/user-facing flair so future flair redesign cannot erase moderation history.

## Post flair migration

Historical `r/catgirlcoin` posts do not need to be copied merely to migrate definitions.

Migration should:

1. export all source post templates and semantics;
2. assign stable logical IDs;
3. create equivalent target templates in `r/nyaonearth`;
4. record the source/logical/target mapping;
5. make new Reddit posting and crossposting code select target templates through the logical mapping rather than source UUIDs;
6. preserve question/help semantics in the new primary community.

## Dry-run output

Before any target write, produce a machine-readable or deterministic report containing at least:

- source user template count;
- source post template count;
- source user assignment count;
- proposed logical mappings;
- unmapped templates;
- duplicate/ambiguous semantic candidates;
- warned/banned state mismatches;
- proposed destination creates;
- proposed assignment writes;
- users that cannot currently be resolved.

No target mutation is permitted during this phase.

## Apply phase

The apply tool must be explicitly invoked. It must not run automatically on normal bot startup.

Required properties:

- copy-first source audit artefact;
- stable source hash/revision for the plan being applied;
- deterministic action keys;
- safe retry after rate limits/network errors;
- no duplicate template creation on rerun;
- no duplicate assignment work on rerun;
- classified permanent versus retryable failures;
- sanitised logging;
- complete action journal.

## Verification

After apply, report:

- source user template count;
- destination mapped user template count;
- source post template count;
- destination mapped post template count;
- source assignment count in migration scope;
- successfully migrated assignment count;
- already-correct count;
- skipped/deleted/suspended account count;
- failed count;
- unmapped count;
- semantic mismatch list;
- warned/banned reconciliation mismatches;
- spot-check sample of logical ID to source/destination template presentation.

The migration is not complete while unexplained semantic mismatches remain.
