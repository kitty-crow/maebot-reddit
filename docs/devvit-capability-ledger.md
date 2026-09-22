# Devvit Migration Status and Capability Ledger

Date: 2026-09-22  
Target Devvit version: 0.14.4  
Branch: `feat/devvit-migration-clean`

## Current production decision

**Mae uses the existing Reddit OAuth/Data API implementation for every Reddit operation.**

No Mae Reddit read, mutation, Modmail action, Mod Note action, flair action, post, score lookup, DM operation, media operation, moderation operation, or publishing path is currently routed through Devvit.

The Devvit app exists only as a minimal presence/proof-of-port:

- registered app: `this-is-the-mae`
- Reddit permission enabled
- no media permission
- no Redis
- no scheduler
- no settings service
- no External Endpoint dependency
- no public Mae Reddit hostname
- no additional Mae listener or port
- no polling/spool/queue bridge
- no Discord, Telegram, Tickets, Twitter, moderation, reputation, or Mae-state logic

Its only runtime route is:

```text
GET /api/status
```

That route resolves Devvit's injected app account with `reddit.getAppUser()` and reports that the app is alive. It is not part of Mae's production Reddit transport.

## Architecture

The production path remains:

```text
Mae business logic
      |
      v
existing Reddit clients
      |
      v
Reddit OAuth / Data API
```

The staged future architecture remains:

```text
Mae business logic
      |
      | same existing Reddit-shaped calls
      v
transport boundary
      |
      +--> OAuth / Data API                 (active for everything today)
      |
      '--> generic Devvit compatibility adapter   (staged, currently unwired)
                |
                v
              Devvit
                |
                v
              Reddit
```

The critical rule is unchanged:

> **Do not change Mae to fit Devvit. The adapter must translate what Mae already does into what Devvit expects.**

Mae must not learn Devvit method names, Devvit object models, Devvit media conventions, Devvit storage, Devvit authentication internals, or Devvit transport details.

## What is currently active

| Surface | Current route |
| --- | --- |
| Mae Reddit reads | OAuth |
| Mae Reddit mutations | OAuth |
| Mae Modmail | OAuth |
| Mae DMs | OAuth |
| Mae Mod Notes | OAuth |
| Mae moderation relationships | OAuth |
| Mae flair reads/writes | OAuth |
| Mae posts/crossposts | OAuth |
| Mae score sampling | OAuth |
| Mae sticky reads/writes | OAuth |
| Mae emoji management | OAuth |
| Mae media uploads | OAuth |
| Mae image/video/gallery submission | OAuth |
| Main-user announcements | OAuth |
| Devvit app presence | Devvit `GET /api/status` only |

There is intentionally **no mixed runtime routing yet**.

## Staged but unwired Devvit work

The branch retains compatibility/controller work that was built and parity-tested before the decision to keep the migration minimal.

These files are intentionally **not imported by the Devvit runtime entrypoint**:

- `devvit/src/server/controller.ts`
- `devvit/src/server/legacyAdapter.ts`
- `devvit/src/server/legacyCompat.ts`
- `devvit/src/server/legacyMutationCompat.ts`

Their tests remain useful because they document translation work already completed and protect it from accidental regression while it is dormant.

The staged mappings include work for several Reddit operations such as:

- app-account identity
- subreddit information
- moderator/ban/mute listings
- rules
- hot/new post listings
- Modmail reads/actions
- self-post/crosspost translation
- selected flair operations
- remove/ban/unban
- outbound private messages
- selected Mod Notes operations
- sticky mutation

**None of those staged mappings are active in production.** Passing parity tests means only that the translation code is preserved, not that Mae uses it.

## Devvit media decision

Devvit media is removed from the current migration completely.

The Devvit app:

- does not request `media` permission;
- does not import `media` from `@devvit/web/server`;
- has no raw-media route;
- has no Devvit media adapter;
- does not attempt image, video, gallery, attachment, or managed-media upload.

Mae's existing raw-byte media APIs remain unchanged and use the old Reddit OAuth implementation.

If Devvit media becomes useful in a future release, the rule remains the same: the **adapter** must convert Mae's existing byte contract into the Devvit representation. Mae must not be modified to supply Devvit-specific URLs or payloads.

## Why the adapter is currently unwired

The compatibility work is not the current blocker. The supported production invocation path is.

Devvit 0.14.4 manages Reddit authentication inside its hosted runtime. The public SDK exposes runtime-injected Reddit capability clients, but does not expose a documented external client credential/factory that lets Mae's local Bun process invoke those Reddit plugin calls directly.

Reddit documents:

- normal Devvit `/api/*` server routes for the app runtime/webview model;
- External Endpoints for trusted outside services invoking a hosted Devvit app;
- HTTP Fetch for Devvit calling an external allow-listed backend.

This deployment does **not** depend on External Endpoints, and Mae Reddit must not gain a public hostname merely to make Devvit call back into it.

Therefore the branch deliberately does not invent any of the following:

- public `mae.kittycrow.dev` Reddit bridge
- second Mae port
- Redis queue
- durable RPC spool
- scheduler polling
- fixed-time polling
- Reddit-object signalling
- Discord/Telegram relay
- undocumented Devvit gateway RPC
- Devvit-owned Mae state

Until a supported wire exists that fits the architecture, OAuth remains the complete production transport.

## Known Devvit 0.14.4 gaps relevant to Mae

The following capabilities are incomplete, absent, or semantically insufficient for Mae's current contracts. They remain future backlog, not migration requirements for the current minimal Devvit presence.

### Custom emoji

Devvit 0.14.4 does not provide the complete custom-emoji inventory/upload/permission flow Mae currently uses.

Affected Mae operations:

- emoji inventory
- emoji asset upload
- emoji permission administration

### Flair metadata

Devvit flair models do not expose all legacy metadata Mae relies on, including complete CSS/template assignment information in several paths.

Affected areas include:

- flair template cloning
- authoritative flair reconciliation
- current selected flair template identity

### Private messages

Devvit's private-message model does not provide full parity with Mae's legacy message envelope and exact thread/read-state operations.

Affected areas include:

- inbox/unread/sent history
- exact reply-to-existing-`t4_`
- exact mark-one-message-read
- complete parent/thread/destination metadata

### Subreddit comment history

Devvit does not expose an exact replacement for Reddit's subreddit-wide newest-comment/history listing semantics used by Mae.

### Score sampling

Devvit does not provide Mae's existing batched `/api/info` semantics with complete archived-state parity for all thing types.

### Mute duration

Mae explicitly creates 28-day user mutes. Devvit 0.14.4 does not expose that duration in the equivalent API contract.

### Sticky reads

Devvit can mutate sticky state, but exact legacy sticky-slot read semantics are not exposed.

### Media

Devvit media is intentionally not part of the current migration. All Mae media remains OAuth.

### Native galleries/video

No exact replacement for Mae's existing native gallery/video submission flow is activated.

## Strict TypeScript and architecture enforcement

The dormant adapter remains subject to the repository's strict TypeScript policy.

The branch keeps:

- `strict`
- `exactOptionalPropertyTypes`
- `noUncheckedIndexedAccess`
- `noImplicitOverride`
- `noImplicitReturns`
- `noUnusedLocals`
- `noUnusedParameters`
- strict catch variables
- repository no-loose-types checks

The architecture guard also enforces that the Devvit runtime may import only `reddit` from `@devvit/web/server`.

It rejects reintroduction of:

- Devvit media
- Redis
- scheduler
- settings/persistence services
- failed bridge environment variables
- `DevvitRpcSpool`
- Mae Tickets hostname coupling
- Mae business-module imports
- Discord/Telegram coupling

## Publishing identity invariant

The existing main-user/announcement OAuth identity remains untouched.

Even if Devvit routing is enabled in the future, it must never globally intercept every `RedditMutationClient` instance. Main-account publishing stays OAuth unless an explicit future decision changes that identity policy.

## Future activation procedure

A future Devvit capability must not become active merely because corresponding code already exists in this branch.

For each individual operation:

1. Confirm the current Devvit release exposes exact semantics.
2. Update this ledger with the version and evidence.
3. Add or update adapter-only translation.
4. Keep Mae's caller contract unchanged.
5. Add parity tests against the existing OAuth behaviour.
6. Prove a supported production invocation wire.
7. Run the exact candidate through host CI.
8. Enable only that one transport route.
9. Keep OAuth fallback for everything else.

Until those steps happen, **OAuth is authoritative and Devvit is presence-only**.

## Architectural invariants

- `main` remains the known-good pre-migration line until an explicit cutover decision.
- Mae runtime code is not modified for the current minimal Devvit presence.
- Mae does not know Devvit internals.
- The dormant adapter does not know Mae business internals.
- OAuth credentials remain active for all production Reddit behaviour.
- Devvit has no media permission.
- No fixed-time polling exists.
- No new Mae Reddit port exists.
- Mae's existing internal loopback HTTP listener remains the only Bun listener.
- Mae Reddit has no public hostname.
- `mae.kittycrow.dev` is not part of this architecture.
- Devvit owns no canonical Mae state.
- Dormant compatibility code is not considered an active migration.
- A green compile/test does not itself authorise routing a capability through Devvit.
