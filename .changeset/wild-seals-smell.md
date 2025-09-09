---
"@tanstack/db": patch
---

fix a bug where a live query with a custom getKey would not update correctly because the source key was being used instead of the custom key for presence checks.
