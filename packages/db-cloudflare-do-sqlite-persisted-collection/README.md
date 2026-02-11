# @tanstack/db-cloudflare-do-sqlite-persisted-collection

Thin SQLite persistence for Cloudflare Durable Objects.

## Public API

- `CloudflareDOSQLiteDriver`
- `createCloudflareDOSQLitePersistence(...)`
- `persistedCollectionOptions(...)` (re-exported from core)

## Quick start

```ts
import { createCollection } from '@tanstack/db'
import {
  CloudflareDOSQLiteDriver,
  createCloudflareDOSQLitePersistence,
  persistedCollectionOptions,
} from '@tanstack/db-cloudflare-do-sqlite-persisted-collection'

type Todo = {
  id: string
  title: string
  completed: boolean
}

export class TodosObject extends DurableObject {
  persistence = createCloudflareDOSQLitePersistence({
    driver: new CloudflareDOSQLiteDriver({
      // Pass full storage to use native DO transaction support.
      storage: this.ctx.storage,
    }),
  })

  todos = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: `todos`,
      getKey: (todo) => todo.id,
      persistence: this.persistence,
      schemaVersion: 1, // Per-collection schema version
    }),
  )
}
```

## Notes

- One shared persistence instance can serve multiple collections.
- Mode defaults are inferred from collection usage:
  - sync config present => `sync-present-reset`
  - no sync config => `sync-absent-error`
- You can still override with `schemaMismatchPolicy` if needed.
