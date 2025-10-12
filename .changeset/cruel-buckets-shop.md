---
"@tanstack/db": patch
---

Added `isLoadingMore` property and `loadingMore:change` events to collections and live queries, enabling UIs to display loading indicators when more data is being fetched via `syncMore`. Each live query maintains its own isolated loading state based on its subscriptions, preventing loading status "bleed" between independent queries that share the same source collections.
