---
'@tanstack/db': patch
---

Improve DuplicateKeySyncError message when using `.distinct()` with custom `getKey`. The error now explains that `.distinct()` deduplicates by the entire selected object, and provides actionable guidance to fix the issue.
