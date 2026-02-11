# @tanstack/db-cloudflare-do-sqlite-persisted-collection

Cloudflare Durable Object SQLite persistence wrappers for TanStack DB, built on
the shared `@tanstack/db-sqlite-persisted-collection-core` adapter.

## Exported API (complete)

### Cloudflare DO driver APIs

- `DurableObjectSqlStorageLike`
- `DurableObjectTransactionExecutor`
- `DurableObjectStorageLike`
- `CloudflareDOSQLiteDriverOptions`
- `CloudflareDOSQLiteDriver`
- `createCloudflareDOSQLiteDriver(...)`

### Cloudflare DO persistence APIs

- `CloudflareDOPersistenceMode`
- `CloudflareDOCoreSchemaMismatchPolicy`
- `CloudflareDOSchemaMismatchPolicy`
- `CloudflareDOSQLitePersistenceAdapterOptions`
- `CloudflareDOSQLitePersistenceOptions`
- `CloudflareDOCollectionConfig`
- `CloudflareDOSQLitePersistenceAdapter<T, TKey>`
- `resolveCloudflareDOSchemaMismatchPolicy(...)`
- `createCloudflareDOSQLitePersistenceAdapter<T, TKey>(...)`
- `createCloudflareDOSQLitePersistence<T, TKey>(...)`
- `CloudflareDOCollectionRegistry`
- `createCloudflareDOCollectionRegistry(...)`
- `initializeCloudflareDOCollections(...)`

### Re-exported core APIs

This package re-exports **all** exports from
`@tanstack/db-sqlite-persisted-collection-core` at the root entrypoint
(including `persistedCollectionOptions` and core types/errors).

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

## Transaction behavior in Durable Objects

When `driver.storage` is provided (recommended in real Durable Objects), the
driver runs writes through `state.storage.transaction(...)` and intentionally
does not emulate nested SQL savepoints in that mode.

- Top-level transactions are supported.
- Nested transactions throw an explicit configuration error.

This aligns with Durable Objects' native transaction model and avoids unsafe
SQL-level transaction orchestration in Workers runtime.

## Testing

- `pnpm test` runs unit/contract suites for the DO driver and persistence
  helpers.
- `pnpm test:e2e` runs integration tests against a real local Cloudflare
  runtime using `wrangler dev --local`.
