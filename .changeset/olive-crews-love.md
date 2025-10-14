---
"@tanstack/db": patch
---

Add a scheduler that ensures that if a transaction touches multiple collections that feed into a single live query, the live query only emits a single batch of updates. This fixes an issue where multiple renders could be triggered from a live query under this situation.
