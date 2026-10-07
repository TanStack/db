---
'@tanstack/db': patch
'@tanstack/react-db': patch
---

A live query no longer starts network work for its source collections before it has a subscriber or a preload. Rendering a component that never commits, or creating a live query with `startSync: true`, reads only the rows its sources already hold; the first subscriber or `preload()` starts the sources' sync and loads on-demand data. This applies to nested live queries and pooled `eq` queries too. `useLiveSuspenseQuery` preloads during render, so a source that already holds the rows still renders without suspending. A source collection's `subscriberCount` and `subscribers:change` now count only subscribers that ask for data, so a live query waiting for its first subscriber no longer makes a Query Collection refetch.
