# Flair planner

`src/flair/plan.ts` is an offline dry-run planner. It has no Reddit mutation capability.

Each retained source flair must have an explicit mapping from the `r/catgirlcoin` template ID to a stable logical ID. Source template IDs are never reused as `r/nyaonearth` template IDs.

For each mapped template, the planner compares displayed text, CSS class, colours, mod-only/editable flags, allowable content and emoji limits. One equivalent destination template is reusable, no equivalent template requires later creation, and multiple equivalents are reported as ambiguous.

User assignment planning distinguishes already-correct assignments, required assignments, unmapped source flair and cases blocked until a destination template is resolved. The read-only subreddit audit includes user-flair assignments from both communities so this comparison can be made before any migration work.

Warned and banned state remains independent of cosmetic flair. The planner reports disagreements between durable legacy warned/banned state and visible legacy CSS signals (`w`, `u`, `s`) rather than silently choosing one source.

The planner only produces data. Live inventory, legacy-state parsing, reviewed logical mappings and a separately gated migration tool are still required before any target change is possible.
