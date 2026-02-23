---
'@tanstack/db': patch
---

fix: avoid DuplicateKeySyncError in LEFT JOIN live queries when custom getKey only considers the left collection's identity
