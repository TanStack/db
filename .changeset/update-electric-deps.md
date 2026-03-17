---
'@tanstack/electric-db-collection': patch
---

Update dependencies: `@electric-sql/client` ^1.5.13, `@tanstack/store` ^0.9.2, `pg` ^8.20.0. Adapt subscription cleanup to `@tanstack/store` 0.9.x API which returns `Subscription` objects instead of unsubscribe functions.
