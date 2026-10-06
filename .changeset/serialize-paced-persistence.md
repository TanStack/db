---
'@tanstack/db': patch
---

Keep debounce and throttle persistence serial while an earlier write is still running. Preserve the pending optimistic transaction until its persistence callback can start.
