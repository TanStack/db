---
"@tanstack/electric-db-collection": patch
---

Fix eager mode incorrectly committing data on `snapshot-end` before receiving the first `up-to-date` message. The `snapshot-end` in the Electric log can be from a significant period before the stream is actually up to date, so commits should only occur on `up-to-date` (or on `snapshot-end` after the first `up-to-date` has been received). This change does not affect `on-demand` mode where `snapshot-end` correctly triggers commits, or `progressive` mode which was already protected by its buffering mechanism.
