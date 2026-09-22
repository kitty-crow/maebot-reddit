# This Is The Mae

Devvit is the Reddit-facing controller for the existing Mae Reddit service.

Mae remains the canonical application runtime. Its existing Bun process owns business logic, durable state, moderation/reputation logic, Twitter integration, direct-message handling, Modmail handling, and its loopback-only internal service API. Devvit is deliberately thin: it executes Reddit operations on Mae's behalf through the Reddit Developer Platform and returns the results.

Ordinary automated Reddit activity runs as the Devvit app account `u/this_is_the_mae`. Existing operations for which Devvit does not expose equivalent semantics remain on Mae's established Reddit API fallback. Main announcements also retain Mae's existing separate main-account publishing identity.

## Fetch Domains

- `mae.kittycrow.dev` — Mae's existing authenticated backend ingress. Devvit uses only the `/v1/devvit` controller route on this host to receive queued Reddit operations from Mae and return their results. Mae's existing internal API remains loopback-only and is not exposed through this integration.

This domain is required as part of migrating the existing Reddit Data API application to Devvit without moving Mae's canonical application state or business logic into Devvit.
