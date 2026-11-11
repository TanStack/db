# Supabase Adapter Reference

## Install

```bash
pnpm add @tanstack/supabase-db-collection @tanstack/react-db @tanstack/query-core @supabase/supabase-js
```

## Required Config

```typescript
import { createCollection } from '@tanstack/react-db'
import { supabaseCollectionOptions } from '@tanstack/supabase-db-collection'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const todoSchema = z.object({
  id: z.string(),
  title: z.string(),
  completed: z.boolean(),
})

const todosCollection = createCollection(
  supabaseCollectionOptions({
    tableName: 'todos',
    keys: ['id'],
    schema: todoSchema,
    supabase,
  }),
)
```

- `tableName` -- Postgres table name (PostgREST endpoint); also used as the collection id
- `keys` -- column(s) that uniquely identify a row; match the primary key(s). The collection key is the column value as a string (`6` becomes `'6'`); composite keys are a JSON array of the string values, such as `'["a","b"]'`. Pass that key to `get`, `update`, and `delete`
- `schema` -- Standard Schema (Zod, Valibot, ...) describing one row
- `supabase` -- `SupabaseClient` used for queries, mutations, and Realtime

## Optional Config

| Option                   | Default             | Description                                                                                                                                           |
| ------------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `syncMode`               | `'on-demand'`       | `'on-demand'` loads only what live queries need (pushes where/orderBy/limit to PostgREST); `'eager'` loads the whole table, paging past `db-max-rows` |
| `realtime`               | `false`             | Subscribe to Postgres changes and reconcile other clients' inserts/updates/deletes                                                                    |
| `realtimeUseFilter`      | `false`             | Experimental. Push each query's WHERE to Realtime as a `postgres_changes` filter to cut message volume                                                |
| `queryClient`            | shared client       | TanStack Query client used for the cache. Shared in the browser, new per call on the server; a `DbClient`'s `queryClient` dependency takes precedence |
| `defaultStringCollation` | TanStack DB default | `StringCollationConfig` from `@tanstack/db`; orders strings to match the database collation                                                           |
| `parse` / `serialize`    | none                | Per-column converters between PostgREST JSON and the schema type (e.g. `timestamptz` string to `Date`); skipped for `null`                            |

## Real-time Subscriptions

Add the table to the `supabase_realtime` publication first:

```sql
alter publication supabase_realtime add table "public"."todos";
```

Then set `realtime: true`. RLS applies to Realtime. Without RLS every change is broadcast to every client. Realtime can consume more messages than expected; test with a spend cap.

## Persistence Handlers

The adapter owns `onInsert`, `onUpdate`, and `onDelete`: they write through PostgREST (`POST`/`PATCH`/`DELETE`, matching on the `keys` columns), write the server-returned row back into the collection, and roll back the optimistic change if the server rejects it. Custom mutation handlers are not part of the options.

## Query Pushdown

Pushed to PostgREST: `where` (`eq`, `gt`, `gte`, `lt`, `lte`, `inArray`, `like`, `ilike`, `not`, `isNull`, `and`, `or`), `orderBy` on source columns, `limit`, and join keys (`in` filter). Evaluated client-side: computed selects, aggregates, `groupBy`, `having`, `distinct`, except an aggregate-only `count`/`sum`/`avg` in `experimental_queryOnce`. Reads page past PostgREST's `db-max-rows` (1000 by default) with `offset`; a multi-page read also orders by the `keys` columns so the pages form one sequence.

## experimental_queryOnce

```typescript
import { eq } from '@tanstack/react-db'
import { experimental_queryOnce } from '@tanstack/supabase-db-collection'

const completed = await experimental_queryOnce(
  (q) =>
    q
      .from({ todo: todosCollection })
      .where(({ todo }) => eq(todo.completed, true)),
  supabase,
)
```

One-shot, non-reactive fetch. It always resolves to what TanStack DB's `queryOnce` returns, and it is experimental because it reads TanStack DB's internal query IR.

A query runs as one PostgREST request only when its select holds just `count`, `sum`, or `avg` of a plain column of one Supabase table (not `sum`/`avg` over a `parse` column), every filter can be pushed, and it has no `groupBy`, `having`, join, `orderBy`, `limit`, `offset`, `distinct`, or functional clause. That path needs PostgREST aggregates:

```sql
alter role authenticator set pgrst.db_aggregates_enabled = 'true';
notify pgrst, 'reload config';
```

Every other query, including `min`, `max`, `groupBy`, and `having`, runs through TanStack DB's `queryOnce` over the collections, which push filters, order, and limit to PostgREST. TanStack DB's aggregate rules apply: an empty match gives `[]` (`undefined` for `findOne`), and an all-null `sum` gives `0`.

## Use with DbClient

Under a `DbClient`, wrap the options in `collectionOptions` and materialize with `dbClient.collection`. The client's `queryClient` dependency is used for the cache.

```typescript
import { QueryClient } from '@tanstack/query-core'
import { DbClient, collectionOptions } from '@tanstack/db'

const todosDescriptor = collectionOptions(
  supabaseCollectionOptions({
    tableName: 'todos',
    keys: ['id'],
    schema: todoSchema,
    supabase,
  }),
)

const dbClient = new DbClient({ queryClient: new QueryClient() })
const todos = dbClient.collection(todosDescriptor)
```

## Complete Example

```tsx
import { createCollection, useLiveQuery, eq } from '@tanstack/react-db'
import { supabaseCollectionOptions } from '@tanstack/supabase-db-collection'

const todosCollection = createCollection(
  supabaseCollectionOptions({
    tableName: 'todos',
    keys: ['id'],
    schema: todoSchema,
    supabase,
    syncMode: 'on-demand',
    realtime: true,
  }),
)

function Todos() {
  const { data } = useLiveQuery({
    query: (q) =>
      q
        .from({ todo: todosCollection })
        .where(({ todo }) => eq(todo.completed, false)),
  })

  const add = (title: string) =>
    todosCollection.insert({ id: crypto.randomUUID(), title, completed: false })

  const complete = (id: string) =>
    todosCollection.update(id, (draft) => {
      draft.completed = true
    })

  // ...
}
```
