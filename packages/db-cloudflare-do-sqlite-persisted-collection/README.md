# @tanstack/db-cloudflare-do-sqlite-persisted-collection

Cloudflare Durable Object SQLite persistence wrappers for TanStack DB, built on
the shared `@tanstack/db-sqlite-persisted-collection-core` adapter.

## Core APIs

- `createCloudflareDOSQLiteDriver`
- `createCloudflareDOSQLitePersistenceAdapter`
- `createCloudflareDOSQLitePersistence`
- `resolveCloudflareDOSchemaMismatchPolicy`
- `createCloudflareDOCollectionRegistry`
- `initializeCloudflareDOCollections`

## Durable Object setup

```ts
import { createCollection } from '@tanstack/db'
import {
  createCloudflareDOSQLitePersistence,
  persistedCollectionOptions,
} from '@tanstack/db-cloudflare-do-sqlite-persisted-collection'

type Todo = {
  id: string
  title: string
  completed: boolean
}

export class TodosObject extends DurableObject {
  private readonly persistence = createCloudflareDOSQLitePersistence<Todo, string>(
    {
      driver: {
        // Passing full storage enables native DO transactions under the hood.
        storage: this.ctx.storage,
      },
      // Use `sync` mode when this DO is the authoritative sync host.
      mode: `local`,
      schemaVersion: 1,
    },
  )

  readonly todos = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: `todos`,
      getKey: (todo) => todo.id,
      persistence: this.persistence,
    }),
  )
}
```

## Schema mismatch defaults

- `mode: 'local'` defaults to `schemaMismatchPolicy: 'sync-absent-error'`
- `mode: 'sync'` defaults to `schemaMismatchPolicy: 'sync-present-reset'`

You can override `schemaMismatchPolicy` explicitly when needed (`'throw'` is
accepted as an alias for `'sync-absent-error'`).

## Testing

- `pnpm test` runs unit/contract suites for the DO driver and persistence
  helpers.
- `pnpm test:e2e` runs integration tests against a real local Cloudflare
  runtime using `wrangler dev --local`.
