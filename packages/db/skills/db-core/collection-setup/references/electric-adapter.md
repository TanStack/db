# Electric Adapter Reference

## Install

```bash
pnpm add @tanstack/electric-db-collection @tanstack/react-db
```

## Required Config

```typescript
import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'

const collection = createCollection(
  electricCollectionOptions({
    shapeOptions: { url: '/api/todos' },
    getKey: (item) => item.id,
  }),
)
```

- `shapeOptions` -- ElectricSQL ShapeStream config; `url` is the proxy URL to Electric
- `getKey` -- extracts unique key from each item

## Optional Config

| Option                | Default | Description                                         |
| --------------------- | ------- | --------------------------------------------------- |
| `id`                  | (none)  | Unique collection identifier                        |
| `schema`              | (none)  | StandardSchema validator                            |
| `shapeOptions.params` | (none)  | Additional shape params (e.g. `{ table: 'todos' }`) |
| `onInsert`            | (none)  | Persistence handler; should return `{ txid }`       |
| `onUpdate`            | (none)  | Persistence handler; should return `{ txid }`       |
| `onDelete`            | (none)  | Persistence handler; should return `{ txid }`       |

## Three Sync Strategies

### 1. Txid Return (Recommended)

Handler returns `{ txid }`. Client waits for that txid in the Electric stream.

```typescript
onInsert: async ({ transaction }) => {
  const response = await api.todos.create(transaction.mutations[0].modified)
  return { txid: response.txid }
},
```

### 2. awaitMatch (Custom Match)

Use when txids are unavailable. Import `isChangeMessage` to match on message content.

```typescript
import { isChangeMessage } from "@tanstack/electric-db-collection"

onInsert: async ({ transaction, collection }) => {
  const newItem = transaction.mutations[0].modified
  await api.todos.create(newItem)
  await collection.utils.awaitMatch(
    (message) =>
      isChangeMessage(message) &&
      message.headers.operation === "insert" &&
      message.value.text === newItem.text,
    5000 // timeout ms, defaults to 3000
  )
},
```

### 3. Simple Timeout (Prototyping)

```typescript
onInsert: async ({ transaction }) => {
  await api.todos.create(transaction.mutations[0].modified)
  await new Promise((resolve) => setTimeout(resolve, 2000))
},
```

## Utility Methods (`collection.utils`)

- `awaitTxId(txid, timeout?)` -- wait for txid in Electric stream; default timeout 30s
- `awaitMatch(matchFn, timeout?)` -- wait for message matching predicate; default timeout 3000ms

### Helper Exports

```typescript
import {
  isChangeMessage,
  isControlMessage,
} from '@tanstack/electric-db-collection'
// isChangeMessage(msg) -- true for insert/update/delete
// isControlMessage(msg) -- true for up-to-date/must-refetch
```

## generateTxId Backend Pattern

The txid **must** be queried inside the same Postgres transaction as the mutation.

```typescript
async function generateTxId(tx: any): Promise<number> {
  const result = await tx`SELECT pg_current_xact_id()::xid::text as txid`
  const txid = result[0]?.txid
  if (txid === undefined) throw new Error('Failed to get transaction ID')
  return parseInt(txid, 10)
}

async function createTodo(data) {
  let txid!: number
  const result = await sql.begin(async (tx) => {
    txid = await generateTxId(tx) // INSIDE the transaction
    const [todo] = await tx`INSERT INTO todos ${tx(data)} RETURNING *`
    return todo
  })
  return { todo: result, txid }
}
```

Querying txid outside the transaction produces a mismatched txid -- `awaitTxId` stalls indefinitely.

## Schema vs Parser: Two Separate Paths

When using Electric with a schema, data enters the collection via **two independent paths**:

1. **Sync path** — Electric's `ShapeStream` applies the `parser` from `shapeOptions`. The schema is NOT applied to synced data.
2. **Mutation path** — `insert()` and `update()` run through the collection schema. The parser is not involved.

For types that need transformation (e.g., `timestamptz`), you need BOTH configured:

```typescript
const todosCollection = createCollection(
  electricCollectionOptions({
    schema: z.object({
      id: z.string(),
      text: z.string(),
      completed: z.boolean(),           // Electric auto-parses bools
      created_at: z.coerce.date(),      // mutation path: coerce string → Date
    }),
    shapeOptions: {
      url: "/api/todos",
      parser: {
        timestamptz: (value: string) => new Date(value),  // sync path: parse incoming strings
      },
    },
    getKey: (item) => item.id,
  })
)
```

### Postgres → Electric type handling

| PG type | Electric auto-parses? | Schema needed? | Parser needed? |
|---------|----------------------|----------------|----------------|
| `text`, `uuid` | Yes (string) | `z.string()` | No |
| `int4`, `int8` | Yes (number) | `z.number()` | No |
| `bool` | Yes (boolean) | `z.boolean()` | No |
| `timestamptz` | No (stays string) | `z.coerce.date()` | Yes — `parser: { timestamptz: (v) => new Date(v) }` |
| `jsonb` | Yes (parsed object) | As needed | No |

Note: `z.coerce.date()` is Zod-specific. Other StandardSchema libraries have their own coercion patterns.

## Debug Logging

```javascript
localStorage.debug = 'ts/db:electric'
```

## Complete Example

Always use a schema — types are inferred automatically, avoiding generic placement confusion.

```typescript
import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { z } from 'zod'

const todoSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  completed: z.boolean(),
  created_at: z.coerce.date(),
})

const todosCollection = createCollection(
  electricCollectionOptions({
    id: 'todos',
    schema: todoSchema,
    getKey: (item) => item.id,
    shapeOptions: {
      url: '/api/todos',
      params: { table: 'todos' },
      parser: {
        timestamptz: (value: string) => new Date(value),  // sync path
      },
    },
    onInsert: async ({ transaction }) => {
      const response = await api.todos.create(transaction.mutations[0].modified)
      return { txid: response.txid }
    },
    onUpdate: async ({ transaction }) => {
      const { original, changes } = transaction.mutations[0]
      const response = await api.todos.update({
        where: { id: original.id },
        data: changes,
      })
      return { txid: response.txid }
    },
    onDelete: async ({ transaction }) => {
      const response = await api.todos.delete(transaction.mutations[0].key)
      return { txid: response.txid }
    },
  }),
)
```
