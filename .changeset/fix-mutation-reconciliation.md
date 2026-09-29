---
'@tanstack/db': patch
---

Fix same-key delete-then-insert reduction, preserve whole-row replacements through local adapters, and publish immutable previous values for live-object and replacement-object sync updates. Same-reference live rows still require an immutable provider `previousValue`; stale or partial values on that reused reference remain unsupported.
