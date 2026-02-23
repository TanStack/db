---
'@tanstack/db': patch
---

fix: avoid DuplicateKeySyncError in join live queries when custom getKey only considers the identity of one of the joined collections
