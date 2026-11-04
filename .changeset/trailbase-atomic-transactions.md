---
'@tanstack/trailbase-db-collection': minor
---

**Breaking:** `trailBaseCollectionOptions` now requires `client`, the TrailBase client your record API comes from.

```ts
const client = initClient(url)
trailBaseCollectionOptions({ client, recordApi: client.records('todos'), … })
```

Each transaction's writes now go to TrailBase in one `client.execute(operations, true)` call, so they commit together or not at all. Before, a transaction's updates and deletes went out one at a time, and when TrailBase rejected one, the earlier ones stayed saved while the transaction rolled back in the app.
