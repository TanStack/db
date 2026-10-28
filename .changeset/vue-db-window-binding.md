---
'@tanstack/vue-db': patch
---

`useLiveInfiniteQuery` now uses the shared window binding from `@tanstack/db`. A window collection it creates starts syncing when the query compiles, as in the other adapters, and an update that changes nothing keeps the current controller.
