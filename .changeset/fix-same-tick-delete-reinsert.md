---
'@tanstack/db': patch
---

Fix two bugs where deleting and re-inserting the same key in quick succession could leave `subscribeChanges` subscribers out of sync with the collection, or throw a spurious "already exists" error.
