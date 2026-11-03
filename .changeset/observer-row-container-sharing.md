---
'@tanstack/db': patch
---

Preserve live-query observer data arrays and lazy state Maps across status-only and health-only snapshot updates. Keep value and ordering changes visible while retaining point-in-time snapshots.

Keep snapshot invalidation fresh across discarded Collection publications. Publish nested record prototype changes, while preserving equal writes with the same shape.

Bound object-valued Set matching without changing unordered structural equality. Keep pooled live-query observers working when layout changes use their ordinary change stream.
