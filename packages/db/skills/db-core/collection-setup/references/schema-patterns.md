# Schema Patterns Reference

## StandardSchema Integration

TanStack DB accepts any [StandardSchema](https://standardschema.dev)-compatible library via the `schema` option.

### Supported Libraries

- [Zod](https://zod.dev), [Valibot](https://valibot.dev), [ArkType](https://arktype.io), [Effect Schema](https://effect.website/docs/schema/introduction/)

## TInput vs TOutput

- **TInput** -- type accepted by `insert()` and `update()`
- **TOutput** -- type stored in collection and returned from queries

When no transforms exist, TInput === TOutput.

```typescript
const schema = z.object({
  id: z.string(),
  created_at: z.string().transform((val) => new Date(val)),
})
// TInput:  { id: string, created_at: string }
// TOutput: { id: string, created_at: Date }
```

## Union Pattern for Transforms (Required)

When a schema transforms A to B, TInput **must** accept both A and B. During `update()`, the draft contains TOutput data.

```typescript
// WRONG -- update() fails because draft.created_at is Date but schema expects string
z.string().transform((val) => new Date(val))

// CORRECT
z.union([z.string(), z.date()]).transform((val) =>
  typeof val === 'string' ? new Date(val) : val,
)
// TInput: string | Date, TOutput: Date
```

## Defaults

```typescript
const schema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean().default(false),
  priority: z.number().default(0),
  tags: z.array(z.string()).default([]),
  created_at: z.date().default(() => new Date()),
})
// insert({ id: "1", text: "Task" }) -- missing fields auto-filled
```

## Computed Fields

```typescript
const schema = z
  .object({
    id: z.string(),
    first_name: z.string(),
    last_name: z.string(),
  })
  .transform((data) => ({
    ...data,
    full_name: `${data.first_name} ${data.last_name}`,
  }))
```

## Combining Defaults with Transforms

```typescript
const schema = z.object({
  created_at: z
    .string()
    .default(() => new Date().toISOString())
    .transform((val) => new Date(val)),
})
```

## Validation Examples

```typescript
// Basic constraints
z.string().min(3).max(100)
z.string().email()
z.number().int().positive()
z.enum(['active', 'inactive'])
z.array(z.string()).min(1)

// Optional/nullable
z.string().optional() // can be omitted
z.string().nullable() // can be null

// Cross-field
z.object({ start: z.string(), end: z.string() }).refine(
  (d) => new Date(d.end) > new Date(d.start),
  'End must be after start',
)

// Custom
z.string().refine((v) => /^[a-zA-Z0-9_]+$/.test(v), 'Alphanumeric only')
```

## SchemaValidationError

```typescript
import { SchemaValidationError } from '@tanstack/db'

try {
  collection.insert({ id: '1', email: 'bad', age: -5 })
} catch (error) {
  if (error instanceof SchemaValidationError) {
    error.type // "insert" or "update"
    error.message // "Validation failed with 2 issues"
    error.issues // [{ path: ["email"], message: "Invalid email" }, ...]
  }
}
```

## Scope

- Schemas validate **client mutations only** (`insert()`, `update()`)
- Server/sync data is NOT validated by the schema
- Validation is synchronous, runs on every mutation

## Where TOutput Appears

- Data stored in collection and returned from queries
- `PendingMutation.modified`
- Mutation handler `transaction.mutations[].modified`

## Performance

Keep transforms simple -- validation runs synchronously on every mutation.

## Complete Example

```typescript
import { z } from 'zod'
import { createCollection, SchemaValidationError } from '@tanstack/react-db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

const todoSchema = z.object({
  id: z.string(),
  text: z.string().min(1, 'Text is required'),
  completed: z.boolean().default(false),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  created_at: z
    .union([z.string(), z.date()])
    .transform((val) => (typeof val === 'string' ? new Date(val) : val))
    .default(() => new Date()),
})

const todosCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => fetch('/api/todos').then((r) => r.json()),
    queryClient,
    getKey: (item) => item.id,
    schema: todoSchema,
    onInsert: async ({ transaction }) => {
      const todo = transaction.mutations[0].modified
      await api.todos.create({
        ...todo,
        created_at: todo.created_at.toISOString(),
      })
    },
  }),
)

// Defaults and transforms applied
todosCollection.insert({ id: '1', text: 'Buy groceries' })
// => { id: "1", text: "Buy groceries", completed: false, priority: "medium", created_at: Date }

// Update works -- draft contains TOutput, schema accepts via union
todosCollection.update('1', (draft) => {
  draft.completed = true
})

// Error handling
try {
  todosCollection.insert({ id: '2', text: '' })
} catch (e) {
  if (e instanceof SchemaValidationError) {
    console.log(e.issues) // [{ path: ["text"], message: "Text is required" }]
  }
}
```
