---
'@tanstack/db': patch
'@tanstack/electric-db-collection': patch
'@tanstack/trailbase-db-collection': patch
---

Report incremental subset-load failures through subscriptions, live-query utilities, and effects while keeping cached source rows available. Recover cleanly from failed or overlapping must-refetch replays, collection cleanup, effect teardown errors, and cooperative adapter cancellation. Electric's shared-stream snapshot path still depends on upstream request identity or cancellation support to prevent rows from an aborted request from arriving before the request Promise settles.
