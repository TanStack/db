# TrailBase Adapter Reference

## Install

```bash
pnpm add @tanstack/trailbase-db-collection @tanstack/react-db trailbase
```

## Required Config

```typescript
import { createCollection } from "@tanstack/react-db"
import { trailBaseCollectionOptions } from "@tanstack/trailbase-db-collection"
import { initClient } from "trailbase"

const trailBaseClient = initClient("https://your-trailbase-instance.com")

const todosCollection = createCollection(
  trailBaseCollectionOptions({
    id: "todos",
    recordApi: trailBaseClient.records("todos"),
    getKey: (item) => item.id,
  })
)
```

- `id` -- unique collection identifier
- `recordApi` -- TrailBase Record API instance from `trailBaseClient.records(tableName)`
- `getKey` -- extracts unique key from each item

## Optional Config

| Option | Default | Description |
|---|---|---|
| `schema` | (none) | StandardSchema validator |
| `parse` | (none) | Object mapping field names to functions that transform data coming FROM TrailBase |
| `serialize` | (none) | Object mapping field names to functions that transform data going TO TrailBase |
| `onInsert` | (none) | Handler called on insert |
| `onUpdate` | (none) | Handler called on update |
| `onDelete` | (none) | Handler called on delete |

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

const collection = createCollection<SelectTodo, Todo>(
  trailBaseCollectionOptions({
    id: "todos",
    recordApi: trailBaseClient.records("todos"),
    getKey: (item) => item.id,
    parse: {
      created_at: (ts) => new Date(ts * 1000),
    },
    serialize: {
      created_at: (date) => Math.floor(date.valueOf() / 1000),
    },
  })
)
```

## Real-time Subscriptions

Automatic when `enable_subscriptions` is enabled on the TrailBase server. No additional client config needed -- the collection subscribes to changes automatically.

## Persistence Handlers

```typescript
onInsert: async ({ transaction }) => {
  const newItem = transaction.mutations[0].modified
},
onUpdate: async ({ transaction }) => {
  const { original, modified } = transaction.mutations[0]
},
onDelete: async ({ transaction }) => {
  const deletedItem = transaction.mutations[0].original
},
```

TrailBase handles persistence through the Record API automatically. Custom handlers are for additional logic only.

## Complete Example

```typescript
import { createCollection } from "@tanstack/react-db"
import { trailBaseCollectionOptions } from "@tanstack/trailbase-db-collection"
import { initClient } from "trailbase"
import { z } from "zod"

const trailBaseClient = initClient("https://your-trailbase-instance.com")

const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
  created_at: z.date(),
})

type SelectTodo = {
  id: string
  text: string
  completed: boolean
  created_at: number
}

type Todo = z.infer<typeof todoSchema>

const todosCollection = createCollection<SelectTodo, Todo>(
  trailBaseCollectionOptions({
    id: "todos",
    recordApi: trailBaseClient.records("todos"),
    getKey: (item) => item.id,
    schema: todoSchema,
    parse: {
      created_at: (ts) => new Date(ts * 1000),
    },
    serialize: {
      created_at: (date) => Math.floor(date.valueOf() / 1000),
    },
    onInsert: async ({ transaction }) => {
      console.log("Created:", transaction.mutations[0].modified)
    },
  })
)

// Usage
todosCollection.insert({
  id: crypto.randomUUID(),
  text: "Review PR",
  completed: false,
  created_at: new Date(),
})
```
