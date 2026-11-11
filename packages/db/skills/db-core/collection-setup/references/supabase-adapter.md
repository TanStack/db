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
- `keys` -- column(s) that uniquely identify a row; match the primary key(s). Composite keys are joined with `-` to form the collection key
- `schema` -- Standard Schema (Zod, Valibot, ...) describing one row
- `supabase` -- `SupabaseClient` used for queries, mutations, and Realtime

## Optional Config

| Option              | Default       | Description                                                                                                                                           |
| ------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `syncMode`          | `'on-demand'` | `'on-demand'` loads only what live queries need (pushes where/orderBy/limit to PostgREST); `'eager'` loads the whole table, paging past `db-max-rows` |
| `realtime`          | `false`       | Subscribe to Postgres changes and reconcile other clients' inserts/updates/deletes                                                                    |
| `realtimeUseFilter` | `false`       | Experimental. Push each query's WHERE to Realtime as a `postgres_changes` filter to cut message volume                                                |
| `queryClient`       | shared global | TanStack Query client used for the cache                                                                                                              |

## Real-time Subscriptions

Add the table to the `supabase_realtime` publication first:

```sql
alter publication supabase_realtime add table "public"."todos";
```

Then set `realtime: true`. RLS applies to Realtime. Without RLS every change is broadcast to every client. Realtime can consume more messages than expected; test with a spend cap.

## Persistence Handlers

The adapter owns `onInsert`, `onUpdate`, and `onDelete`: they write through PostgREST (`POST`/`PATCH`/`DELETE`, matching on the `keys` columns), write the server-returned row back into the collection, and roll back the optimistic change if the server rejects it. Custom mutation handlers are not part of the options.

## Query Pushdown

Pushed to PostgREST: `where` (`eq`, `gt`, `gte`, `lt`, `lte`, `inArray`, `like`, `ilike`, `not`, `isNull`, `and`, `or`), `orderBy` on source columns, `limit`, and join keys (`in` filter). Evaluated client-side: computed selects, aggregates, `groupBy`, `having`, `distinct`. Reads page past PostgREST's `db-max-rows` (1000 by default) with `offset`; order by a unique column when a collection may exceed the cap.

## queryOnce

```typescript
import { eq } from '@tanstack/react-db'
import { queryOnce } from '@tanstack/supabase-db-collection'

const completed = await queryOnce(
  (q) =>
    q
      .from({ todo: todosCollection })
      .where(({ todo }) => eq(todo.completed, true)),
  supabase,
)
```

One-shot, non-reactive fetch. Aggregates (`count`, `sum`, `avg`, `min`, `max`) and `groupBy`/`having` run server-side in a single, non-paginated request.

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
  const { data } = useLiveQuery((q) =>
    q
      .from({ todo: todosCollection })
      .where(({ todo }) => eq(todo.completed, false)),
  )

  const add = (title: string) =>
    todosCollection.insert({ id: crypto.randomUUID(), title, completed: false })

  const complete = (id: string) =>
    todosCollection.update(id, (draft) => {
      draft.completed = true
    })

  // ...
}
```
