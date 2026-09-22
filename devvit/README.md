# This Is The Mae

Devvit is the Reddit-facing controller for the existing Mae Reddit service.

Mae remains the canonical application runtime. Its existing Bun process owns business logic, durable state, moderation/reputation logic, Twitter integration, direct-message handling, Modmail handling, and its loopback-only internal service API. Devvit is deliberately thin: it executes Reddit operations on Mae's behalf through the Reddit Developer Platform and returns the results.

Ordinary automated Reddit activity runs as the Devvit app account `u/this_is_the_mae`. Existing operations for which Devvit does not expose equivalent semantics remain on Mae's established Reddit API fallback. Main announcements also retain Mae's existing separate main-account publishing identity.

## Fetch Domains

- `mae.kittycrow.dev` — reverse-proxies only `/v1/devvit/*` to Mae Reddit's existing loopback internal API listener. The Devvit routes use the `maeBridgeSecret`; the rest of Mae Reddit's internal API keeps its existing internal bearer token and is not exposed through nginx. No separate Devvit ingress listener is used.

This keeps the bridge on the same local adapter/API port already used by Mae's other services while preserving authentication separation.
