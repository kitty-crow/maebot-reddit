"""Retired legacy submission-moderation entry point.

Mae's TypeScript moderation and reputation runtime is now the sole authority for
public Reddit moderation, disciplinary flairs, bans, and reputation changes.
This file intentionally remains as a harmless compatibility target so an old
launcher cannot accidentally restore the retired Python enforcement loop.
"""

print(
  "Mae Reddit legacy submission moderation is retired; "
  "TypeScript reputation moderation is authoritative."
)
