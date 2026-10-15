---
'@tanstack/db': minor
'@tanstack/react-db': minor
---

Add `autoLoad: false` to live-query configuration and React query hooks to observe available rows without initiating source loading. Queries remain reactive across joins and pagination, become ready independently of provider loading, and have separate identities from queries that load data automatically.
