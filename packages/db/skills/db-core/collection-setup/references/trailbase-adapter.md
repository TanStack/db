# TrailBase Adapter Reference

## Install

```bash
pnpm add @tanstack/trailbase-db-collection @tanstack/react-db trailbase
```

## Required Config

```typescript
import { createCollection } from '@tanstack/react-db'
import { trailBaseCollectionOptions } from '@tanstack/trailbase-db-collection'
import { initClient } from 'trailbase'

const trailBaseClient = initClient('https://your-trailbase-instance.com')

const todosCollection = createCollection(
  trailBaseCollectionOptions({
    recordApi: trailBaseClient.records('todos'),
    getKey: (item) => item.id,
    parse: {},
    serialize: {},
  }),
)
```

- `recordApi` -- TrailBase Record API instance from `trailBaseClient.records(tableName)`
- `getKey` -- extracts unique key from each item
- `parse` -- field conversions from TrailBase records to collection rows
- `serialize` -- field conversions from collection rows to TrailBase records

Use empty objects for `parse` and `serialize` when both shapes are identical.

## Optional Config

| Option     | Default | Description                  |
| ---------- | ------- | ---------------------------- |
| `id`       | (none)  | Unique collection identifier |
| `syncMode` | `eager` | `eager` or `on-demand`       |

## Conversions (parse/serialize)

TrailBase uses different data formats (e.g. Unix timestamps). Use `parse` and `serialize` for field-level transformations.

```typescript
type SelectTodo = {
  id: string
  text: string
  created_at: number // Unix timestamp from TrailBase
  completed: boolean
}

type Todo = {
  id: string
  text: string
  created_at: Date // Rich JS type for app usage
  completed: boolean
}

const collection = createCollection(
  trailBaseCollectionOptions<Todo, SelectTodo>({
    id: 'todos',
    recordApi: trailBaseClient.records('todos'),
    getKey: (item) => item.id,
    parse: {
      created_at: (ts) => new Date(ts * 1000),
    },
    serialize: {
      created_at: (date) => Math.floor(date.valueOf() / 1000),
    },
  }),
)
```

## Real-time Subscriptions

Automatic when `enable_subscriptions` is enabled on the TrailBase server. No additional client config needed -- the collection subscribes to changes automatically.

## Persistence Handlers

TrailBase owns `onInsert`, `onUpdate`, and `onDelete`. The adapter writes
through the Record API and waits until subscription events confirm the affected
IDs before removing the optimistic overlay. Custom mutation handlers and
`schema` are not part of `TrailBaseCollectionConfig`.

Call `collection.utils.cancel()` to cancel the active TrailBase event reader.

## Complete Example

```typescript
import { createCollection, safeRandomUUID } from '@tanstack/react-db'
import { trailBaseCollectionOptions } from '@tanstack/trailbase-db-collection'
import { initClient } from 'trailbase'

const trailBaseClient = initClient('https://your-trailbase-instance.com')

type Todo = {
  id: string
  text: string
  completed: boolean
  created_at: Date
}

type SelectTodo = {
  id: string
  text: string
  completed: boolean
  created_at: number
}

const todosCollection = createCollection(
  trailBaseCollectionOptions<Todo, SelectTodo>({
    id: 'todos',
    recordApi: trailBaseClient.records('todos'),
    getKey: (item) => item.id,
    parse: {
      created_at: (ts) => new Date(ts * 1000),
    },
    serialize: {
      created_at: (date) => Math.floor(date.valueOf() / 1000),
    },
  }),
)

// Usage
todosCollection.insert({
  id: safeRandomUUID(),
  text: 'Review PR',
  completed: false,
  created_at: new Date(),
})
```
