# Devvit Capability Ledger

Date: 2026-09-22  
Target Devvit version: 0.14.4  
Migration branch: `feat/devvit-migration-clean`

## Purpose

This document is the authoritative migration ledger for the Reddit transport boundary.

Mae's business logic is not being migrated to Devvit. Mae continues to use the same Reddit-facing contracts. The transport layer routes each operation either through the generic Devvit compatibility adapter or through the existing Reddit OAuth/Data API implementation.

The adapter is generic. It knows how to translate Reddit operations to Devvit. It must not know anything about Mae's stores, moderation rules, reputation model, Twitter integration, tickets, Discord, Telegram, or service topology.

## Status rules

- **DEVVIT**: Devvit 0.14.4 exposes the required capability closely enough to implement the current contract. This still requires adapter parity tests before cutover.
- **OAUTH**: Devvit 0.14.4 does not expose an equivalent capability with the semantics Mae currently relies on. Keep the existing OAuth/Data API implementation.
- **VERIFY**: A related Devvit capability exists, but exact 0.14.4 parity has not yet been proven. Keep OAuth active until type-checking, unit parity tests and a private-installation test prove equivalence.
- **MIXED**: The public Mae method covers more than one Reddit capability. Route supported cases through Devvit and unsupported cases through OAuth.

A feature does not move from **OAUTH** or **VERIFY** to **DEVVIT** merely because a later Devvit release documents something similar. The exact behaviour Mae relies on must be demonstrated first.

## Read surface

| Mae operation | Status | Devvit 0.14.4 target | Notes |
| --- | --- | --- | --- |
| `me()` | DEVVIT | `reddit.getAppUser()` | App-account identity. |
| `subreddit(name)` | DEVVIT | `reddit.getSubredditInfoByName()` | Adapter must preserve Mae's existing Reddit-shaped return object. |
| `moderators(name)` | DEVVIT | `reddit.getModerators(...).all()` | Preserve permission decoding. |
| `bannedUsers(name)` | DEVVIT | `reddit.getBannedUsers(...).all()` | Listing translation required. |
| `bannedUser(name, user)` | DEVVIT | banned-user listing + exact username match | Compatibility helper, not a new Mae concept. |
| `mutedUsers(name)` | DEVVIT | `reddit.getMutedUsers(...).all()` | Listing translation required. |
| `mutedUser(name, user)` | DEVVIT | muted-user listing + exact username match | Compatibility helper. |
| `emojis(name)` | OAUTH | none verified | Devvit RedditClient does not currently expose the subreddit custom-emoji inventory used by Mae. |
| `userFlairTemplates(name)` | DEVVIT | `reddit.getUserFlairTemplates()` | Preserve template metadata. |
| `postFlairTemplates(name)` | DEVVIT | `reddit.getPostFlairTemplates()` | Preserve template metadata. |
| `userFlairAssignments(name)` | VERIFY | related user-flair APIs exist | Exact complete subreddit flair-assignment inventory semantics must be proven for 0.14.4. OAuth remains authoritative meanwhile. |
| `userFlairAssignment(name, user)` | VERIFY | related user-flair APIs exist | Must prove exact single-user lookup semantics and fields. |
| `rules(name)` | DEVVIT | `reddit.getRules()` | The forensic branch unnecessarily kept this on OAuth. |
| `sticky(name, slot)` | VERIFY | post objects expose sticky state | Need exact slot 1/2 read semantics. Filtering hot posts is not accepted as parity. |
| `hotPosts(name, limit)` | DEVVIT | `reddit.getHotPosts(...).all()` | Listing mapping required. |
| `newPosts(name, limit)` | DEVVIT | `reddit.getNewPosts(...).all()` | Listing mapping required. |
| `newComments(name, limit)` | OAUTH | no subreddit-wide latest-comments listing | Devvit `getComments()` is scoped to a post/comment, not the old `/r/<sub>/comments` feed. |
| `newPostsHistory(name, max)` | DEVVIT | `reddit.getNewPosts(...).all()` | Verify pagination/maximum semantics. |
| `newCommentsHistory(name, max)` | OAUTH | no exact subreddit-wide comment-history listing | Do not create adapter state merely to emulate this. |
| `inboxDirectMessages(max)` | VERIFY | `reddit.getMessages({ type: 'inbox' })` | Related API exists. Exact message shape, paging and identity semantics still require parity tests. |
| `unreadDirectMessages(max)` | VERIFY | `reddit.getMessages({ type: 'unread' })` | Same requirement as inbox. |
| `sentDirectMessages(max)` | VERIFY | `reddit.getMessages({ type: 'sent' })` | Same requirement as inbox. |
| `modmailConversations(name, limit)` | DEVVIT | `reddit.modMail.getConversations()` | Devvit 0.14.4 documents subreddit filters, state, sort and limit. |
| `modmailConversation(id, markRead)` | DEVVIT | `reddit.modMail.getConversation()` | `markRead` is directly represented. |
| `scores(fullnames)` | DEVVIT | `getPostById()` / `getCommentById()` | Semantically possible, but one legacy batch read becomes multiple Devvit object reads. Performance/quota impact must be measured. |

## Mutation surface

| Mae operation | Status | Devvit 0.14.4 target | Notes |
| --- | --- | --- | --- |
| `submitSelf(...)` | DEVVIT | `reddit.submitPost()` | Preserve app-account authorship and flair behaviour. |
| `crosspost(...)` | DEVVIT | `reddit.crosspost()` | Preserve source fullname and flair behaviour. |
| `createFlairTemplate(...)` | DEVVIT | `createUserFlairTemplate()` / `createPostFlairTemplate()` | Translate metadata exactly. |
| `uploadEmoji(...)` | OAUTH | none verified | Custom emoji asset-upload flow remains legacy. |
| `updateEmojiPermissions(...)` | OAUTH | none verified | Custom emoji permission administration remains legacy. |
| `setUserFlairTemplate(...)` | DEVVIT | `reddit.setUserFlair()` | Preserve template ID and optional custom text. |
| `userFlairSelection(...)` | VERIFY | related flair APIs exist | Need parity with old `/api/flairselector` current-selection response. |
| `setUserFlairDirect(...)` | DEVVIT | `reddit.setUserFlair()` | Preserve direct text/CSS semantics where Devvit exposes them. |
| `setPostFlairTemplate(...)` | DEVVIT | `reddit.setPostFlair()` | Preserve template ID and custom text. |
| `remove(fullname)` | DEVVIT | `reddit.remove(id, false)` | Exact mapping. |
| `banUser(...)` | DEVVIT | `reddit.banUser()` | Preserve reason/note truncation and state-mutation gate in Mae. |
| `unbanUser(...)` | DEVVIT | `reddit.unbanUser()` | Exact capability exists. |
| `sendPrivateMessage(...)` | DEVVIT | `reddit.sendPrivateMessage()` | New outbound PM is supported. |
| `replyToPrivateMessage(t4, body)` | OAUTH | no reply-to-existing-PM method verified | Devvit can send a new PM, but that is not equivalent to replying inside an existing t4 thread. |
| `markPrivateMessageRead(t4)` | VERIFY | `PrivateMessage.markAsRead()` | Object method exists, but exact lookup-by-fullname path and error semantics must be proven. |
| `replyModmail(...)` | DEVVIT | `reddit.modMail.reply()` | 0.14.4 supports `isAuthorHidden` and `isInternal`. |
| `archiveModmail(...)` | DEVVIT | `reddit.modMail.archiveConversation()` | Exact capability exists. |
| `muteModmail(...)` | DEVVIT | `reddit.modMail.muteConversation()` | 72, 168 and 672 hour values match Mae's contract. |
| `unmuteModmail(...)` | DEVVIT | `reddit.modMail.unmuteConversation()` | Exact capability exists. |
| `muteUser(...)` | DEVVIT | `reddit.muteUser()` | Preserve note semantics. |
| `unmuteUser(...)` | DEVVIT | `reddit.unmuteUser()` | Exact capability exists. |
| `sticky(postId, slot)` | DEVVIT | `Post.sticky(slot)` | Mutation is supported even though exact sticky-slot read remains VERIFY. |

## Media surface

| Mae operation | Status | Devvit 0.14.4 target | Notes |
| --- | --- | --- | --- |
| `uploadMedia(name, mime, bytes)` | MIXED | Devvit media upload for supported image media | Image path is expected to move to Devvit. Video/raw-media parity is not yet proven and remains OAuth. |
| `submitMedia(...)` | MIXED | media upload + `reddit.submitPost()` | Plain image submission is expected to use Devvit. Native video and any legacy body-plus-media semantics stay OAuth until exact parity is proven. |
| `submitGallery(...)` | OAUTH | no exact native gallery submission flow proven | Keep the existing gallery implementation until Devvit exposes and verifies equivalent behaviour. |

## Member Mod Notes surface

| Mae operation | Status | Devvit 0.14.4 target | Notes |
| --- | --- | --- | --- |
| `recentCommentsInCommunities(...)` | VERIFY | `reddit.getCommentsByUser()` + community filtering | Devvit has a user-comment listing, which may be a cleaner replacement than the old subreddit-history scan. Ordering, scan limit and community filtering must match before routing changes. |
| `addModNote(...)` | DEVVIT | `reddit.addModNote()` | Preserve native Mod Note ID and label semantics. |
| `deleteModNote(...)` | DEVVIT | `reddit.deleteModNote()` | Preserve note-id validation. |

## Known Devvit gaps and future retirement backlog

These are the current capabilities for which the OAuth implementation must remain available unless a future Devvit release adds an exact equivalent.

1. **Subreddit custom emoji inventory**
   - Current Mae operation: `emojis()`
   - Needed Devvit capability: list all custom subreddit emojis including URL and permission metadata.

2. **Subreddit custom emoji asset upload**
   - Current Mae operation: `uploadEmoji()`
   - Needed Devvit capability: upload/replace custom emoji bytes and return equivalent asset state.

3. **Subreddit custom emoji permission administration**
   - Current Mae operation: `updateEmojiPermissions()`
   - Needed Devvit capability: change custom emoji permission metadata.

4. **Subreddit-wide newest-comment listing**
   - Current Mae operations: `newComments()`, `newCommentsHistory()`
   - Needed Devvit capability: an exact equivalent of Reddit's subreddit comment listing with ordering and pagination.
   - Devvit comment triggers are not treated as equivalent because emulating a listing from retained events would create adapter state and change bootstrap/history semantics.

5. **Reply to an existing private-message thread**
   - Current Mae operation: `replyToPrivateMessage()`
   - Needed Devvit capability: reply to an existing `t4_` object/thread rather than composing a new message.

6. **Native Reddit gallery submission**
   - Current Mae operation: `submitGallery()`
   - Needed Devvit capability: exact multi-image gallery creation with equivalent flair/result semantics.

## Capabilities still under verification

These are not declared Devvit gaps yet. OAuth remains the safe route until 0.14.4 parity is demonstrated.

- Complete subreddit user-flair assignment inventory.
- Single-user flair assignment lookup.
- Current user-flair selection equivalent to `/api/flairselector`.
- Exact sticky slot 1/2 read semantics.
- Inbox/unread/sent PM listing shape and pagination.
- Mark-one-PM-read from an existing `t4_` fullname.
- Native video upload/submission.
- Image/media submission when Mae supplies both native media and a body.
- `recentCommentsInCommunities()` via `getCommentsByUser()`.
- Score sampling cost when one old `/api/info` batch maps to multiple Devvit object reads.

## Runtime invocation constraint

This ledger tracks Reddit API capability parity separately from the physical invocation mechanism.

Devvit 0.14.4 manages Reddit authentication inside its hosted runtime when `permissions.reddit` is enabled. It does not document a traditional Devvit client ID/client secret that an external Bun service can use to invoke `reddit.*` directly.

Conventional Devvit `/api/*` server endpoints are documented as webview-client-to-Devvit-server endpoints. Reddit documents External Endpoints separately for trusted outside services invoking a hosted Devvit app.

Therefore:

- do not put an invented "Devvit OAuth" flow into Mae;
- do not use undocumented Devvit CLI/gateway internals as a production transport;
- do not reintroduce a public Mae Reddit hostname as a shortcut;
- keep the generic adapter independent of the eventual invocation mechanism;
- do not wire Mae to the adapter until that mechanism is supported and demonstrated.

This is a transport constraint, not a reason to move Mae business logic into Devvit.

## Upgrade procedure

When a future Devvit release adds one of the missing capabilities:

1. Update this ledger first and record the Devvit version that adds the capability.
2. Add the translation only inside the generic adapter/transport layer.
3. Add parity tests against the existing OAuth behaviour.
4. Validate against a private Devvit installation.
5. Run the exact candidate through Mae's host CI on the user's server.
6. Switch only that one capability from OAuth to the adapter.
7. Do not alter Mae business callers to accommodate the transport.

## Architectural invariants

- The migration is developed off `main`; `main` remains the known-good pre-migration bot until cutover.
- Mae does not know Devvit internals.
- The generic adapter does not know Mae internals.
- OAuth credentials remain configured while any ledger entry still requires OAuth.
- Devvit app registration and Reddit permissions are added; no external Devvit client secret is assumed.
- Devvit-managed Reddit authentication exists inside the hosted Devvit runtime. Any Mae-to-Devvit invocation mechanism must be separately proven and must not be invented in Mae.
- Routing occurs at the Reddit transport boundary.
- No fixed-time polling is introduced for the adapter.
- No new Mae Reddit port is introduced.
- Mae's existing internal loopback HTTP listener remains the only Bun listener.
- Mae Reddit has no public hostname.
- `mae.kittycrow.dev` is not part of this architecture.
- No Devvit transport state becomes canonical Mae state.
- No capability is marked migrated merely because TypeScript compiles.

## Reference documentation

- Devvit 0.14.4 changelog: https://developers.reddit.com/docs/changelog
- Devvit public API 0.14.4: https://developers.reddit.com/docs/api/public-api
- RedditClient 0.14.4: https://developers.reddit.com/docs/api/public-api/classes/RedditClient
- ModMailService 0.14.4: https://developers.reddit.com/docs/api/public-api/classes/ModMailService
