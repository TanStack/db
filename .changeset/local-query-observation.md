---
'@tanstack/db': minor
'@tanstack/react-db': minor
---

Add `localOnly` live-query configuration and React's `useLocalLiveQuery` hook to reactively evaluate available collection rows without initiating source loading. Local queries support joins, includes and pagination, become ready independently of provider loading, and use separate query identities from fetching queries.
