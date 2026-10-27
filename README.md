# Mae Reddit

Mae is the Reddit side of the Mae bot suite. She looks after community activity, moderation, member reputation, Modmail, private messages and publishing across **r/catgirlcoin** and **r/nyaonearth**. She's a long-running TypeScript service on Linux, built with [Bun](https://bun.sh/), with persistent state and a local API for the other Mae services.

Mae runs alongside **Mae Discord**, **Mae Telegram**, **Mae Twitter**, **Mae Tickets** and **Mae Dashboard**. A moderator can review a Reddit case in Discord or Telegram, handle a Modmail conversation in Tickets, or issue an action from the Dashboard; Mae Reddit keeps the records and carries out the Reddit-side work.

## What Mae does

- **Moderation:** Checks submissions, comments and private conversations; applies subreddit policies; manages approvals, removals, bans, mutes and moderation notices. Moderator exemptions and community-specific rules are part of the decision flow.
- **Member reputation:** Maintains a durable reputation and discipline history, tracks contributions and score changes, and reconciles member flairs and moderation outcomes with Reddit.
- **Human reviews:** Sends significant moderation cases to Discord and Telegram. The first authorised decision is recorded centrally, then Mae applies the action and keeps both platforms in sync.
- **Modmail:** Tracks conversations and message events, supplies conversation context to Discord, Telegram and Mae Tickets, and delivers moderator-attributed replies and attachments through a durable outbox.
- **Direct messages:** Can moderate incoming private messages and respond conversationally as Mae. Separate persisted conversation and delivery state helps recover safely after a restart.
- **Community questions:** Tracks questions and accepted answers, including the events Discord uses to keep its question announcements and resolution status up to date.
- **Publishing:** Picks up items from Mae Twitter, publishes them to the configured communities, tracks delivery independently, and coordinates approved Daily Task and weekly posts. Sticky-slot checks protect existing pinned posts.
- **Operations:** Shares health, review and work-queue information with the Dashboard; maintains rate-budget and recovery state for ongoing Reddit activity.

## How the services connect

Mae Reddit owns the Reddit-facing work and provides an authenticated HTTP API on the local machine. Other services use that API to read events, submit moderator decisions, manage Modmail and request administrative actions.

```text
Mae Twitter ────────────────┐
Discord / Telegram ─────────┤
Mae Tickets ────────────────┼── Mae Reddit ── Reddit
Mae Dashboard ──────────────┘       │
                                    └── Local state and work queues
```

The API binds to **127.0.0.1** by default. The usual deployment port is **8767**. The listening address and bearer token are configurable.

## Internal HTTP API

Enable the listener with `REDDIT_INTERNAL_API_PORT` and `REDDIT_INTERNAL_API_TOKEN`. All routes except `GET /health` require:

```http
Authorization: Bearer <REDDIT_INTERNAL_API_TOKEN>
```

Responses use JSON unless otherwise noted.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/health` | Service health, returning `{"ok":true}` |
| GET | `/v1/question-events?after=0&limit=100` | Ordered question-opened and best-answer events with a continuation cursor |
| GET | `/v1/modmail/events?after=0&limit=100` | Ordered Modmail events for Discord and Telegram |
| GET | `/v1/modmail/conversations/{id}` | Conversation, member reputation summary and ticket-ready presentation |
| POST | `/v1/modmail/conversations/{id}/archive` | Archive a Modmail conversation |
| POST | `/v1/modmail/media/{id}` | Upload an attachment for a Modmail conversation |
| POST | `/v1/modmail/replies` | Queue and attempt delivery of an attributed moderator reply |
| GET | `/v1/moderation/reviews/pending` | Pending moderation cases |
| GET | `/v1/moderation/reviews/{key}` | Current case, decision and application status |
| POST | `/v1/moderation/reviews/decision` | Record an authorised moderator's approve/reject decision |
| POST | `/v1/moderation/users/action` | Apply a manual member action through Mae's reputation and moderation workflow |
| POST | `/v1/rate/force-drain` | Request an operator-controlled drain of queued Reddit work |

### Request examples

A moderation decision from Discord or Telegram:

```http
POST /v1/moderation/reviews/decision
Authorization: Bearer <token>
Content-Type: application/json

{"key":"review-key","choice":"approve","platform":"discord","userId":"123","userName":"Moderator"}
```

A Modmail reply from Discord, Telegram or Mae Tickets:

```http
POST /v1/modmail/replies
Authorization: Bearer <token>
Content-Type: application/json

{"key":"unique-delivery-key","conversationId":"abc123","platform":"telegram","userId":"123","handle":"Moderator","text":"Thanks for getting in touch.","attachmentIds":[]}
```

The reply endpoint returns `queued`, `delivered` and the stored reply record. `200` indicates immediate delivery; `202` indicates that the reply is queued for recovery or retry. Attachments are scoped to their conversation. Media uploads send the file body with its MIME type and an `X-Mae-File-Name` header.

Moderation decisions are recorded once: a later response from another review surface receives the existing result. Event consumers retain their own cursors and message pointers, allowing them to resume without replaying old announcements.

## Configuration

Mae reads a local `.env` using `dotenv`. Start with the supplied example:

```bash
cp .env.example .env
```

The main settings are:

| Variables | What they configure |
| --- | --- |
| `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME`, `REDDIT_PASSWORD` | Reddit account and API credentials |
| `REDDIT_USER_AGENT` | Identifiable Reddit API user agent |
| `REDDIT_ANNOUNCEMENT_USERNAME`, `REDDIT_ANNOUNCEMENT_PASSWORD` | Publishing identity for approved Daily Task announcements |
| `REDDIT_SOURCE_SUBREDDIT`, `REDDIT_PRIMARY_SUBREDDIT` | Community moderation and publishing configuration |
| `TWITTER_API_URL`, `TWITTER_API_TOKEN` | Local Mae Twitter service |
| `DAILY_REVIEW_API_URL`, `DAILY_REVIEW_API_TOKEN` | Shared Daily Task review service |
| `REDDIT_INTERNAL_API_HOST`, `REDDIT_INTERNAL_API_PORT`, `REDDIT_INTERNAL_API_TOKEN` | Local HTTP listener and bearer authentication |
| `REDDIT_MODERATION_ENABLED`, `OPENAI_API_KEY`, `REDDIT_MODERATION_MODEL` | Optional semantic moderation and reputation runtime |
| `REDDIT_DM_ENABLED`, `REDDIT_MAE_PERSONA`, `REDDIT_DM_MODEL` | Optional private-message conversation handling |
| `REDDIT_RATE_STATE_FILE` | Shared Reddit rate-budget state |
| `REDDIT_STATE_FILE`, `REDDIT_REPUTATION_STATE_FILE`, `REDDIT_MODMAIL_STATE_FILE` | Persistent stores for service, reputation and Modmail state |

`REDDIT_MODERATION_ENABLED` defaults to `false`. Enabling direct-message handling also requires moderation to be enabled. The `.env.example` covers the additional cadence, review, media, state-file and reputation settings.

Keep `.env` and the `data/` directory private. Each service uses its own API token; the other bots authenticate to Mae Reddit with `REDDIT_INTERNAL_API_TOKEN`.

## Install, run and build

Requires **Bun**, **Git** and a Linux host for the normal deployment.

```bash
git clone --recurse-submodules https://github.com/kitty-crow/maebot-reddit.git
cd maebot-reddit
bun ci
cp .env.example .env
# Fill in .env with your service credentials and settings.
bun run start
```

The service runs from `src/main.ts`. It starts its workers and, when configured, the loopback HTTP listener. Use your process supervisor to keep it running and to restart it after updates.

To typecheck and run the test suite:

```bash
bun run ci
```

To produce a Bun server bundle:

```bash
bun build ./src/main.ts --target=bun --outdir dist
```

The bundle is written to `dist/main.js`. For a clean host-side check against a specific Git ref, `bash scripts/hostCi.sh main` runs validation and the build in a disposable checkout.

## Project layout

| Path | Contents |
| --- | --- |
| `src/main.ts` | Service startup, background workers and lifecycle |
| `src/reddit/` | Reddit reads, writes, media, authentication and rate control |
| `src/http/` | Mae's internal HTTP API |
| `src/mod/`, `src/reputation/` | Moderation, member state, discipline and reviews |
| `src/modmail/`, `src/dm/` | Modmail, attachments, direct messages and delivery state |
| `src/questions/`, `src/community/` | Question workflows and community features |
| `src/twitter/`, `src/daily/`, `src/review/` | Publishing and shared Daily Task workflows |
| `data/` | Local persistent protobuf state (deployment-owned) |

Mae's source is here so the behaviour, interfaces and operating requirements can be inspected and maintained openly.
