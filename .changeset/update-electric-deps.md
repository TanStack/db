---
'@tanstack/electric-db-collection': patch
'@tanstack/trailbase-db-collection': patch
'@tanstack/react-db': patch
'@tanstack/solid-db': patch
'@tanstack/vue-db': patch
'@tanstack/powersync-db-collection': patch
'@tanstack/rxdb-db-collection': patch
---

Update dependencies across workspace to resolve version mismatches: `@electric-sql/client` ^1.5.13, `@tanstack/store` ^0.9.2, `pg` ^8.20.0. Adapt subscription cleanup to `@tanstack/store` 0.9.x API which returns `Subscription` objects instead of unsubscribe functions.
