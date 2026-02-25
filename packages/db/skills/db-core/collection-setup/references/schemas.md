# Schema Validation Reference

Schema validation uses the StandardSchema v1 spec. Any compatible library
works: Zod, Valibot, ArkType, Effect Schema.

Schemas validate **client mutations only** (insert, update). Server data
loaded via sync is not validated.

## TInput vs TOutput

When a schema has transformations, it creates two types:
- **TInput** — what users provide to `insert()` / `update()`
- **TOutput** — what's stored in the collection and returned from queries

**Critical rule: TInput must be a superset of TOutput.** During updates,
the draft contains TOutput data (already transformed). The schema must
accept that.

```typescript
// WRONG: TInput only accepts string, but draft.created_at is a Date
const schema = z.object({
  created_at: z.string().transform((val) => new Date(val)),
})
// TInput: { created_at: string }
// TOutput: { created_at: Date }
// update() fails — draft has Date, schema expects string

// CORRECT: TInput accepts both string and Date
const schema = z.object({
  created_at: z
    .union([z.string(), z.date()])
    .transform((val) => (typeof val === 'string' ? new Date(val) : val)),
})
// TInput: { created_at: string | Date }
// TOutput: { created_at: Date }
```

Where types appear at runtime:
- `collection.get(key)` → TOutput
- `useLiveQuery` data → TOutput
- `PendingMutation.modified` → TOutput
- `PendingMutation.changes` → partial TOutput
- `collection.insert(data)` → accepts TInput
- `collection.update(key, (draft) => ...)` → draft is TOutput

## Validation Patterns

### String constraints

```typescript
z.string().min(1, 'Required')
z.string().max(500, 'Too long')
z.string().length(8, 'Must be exactly 8 chars')
z.string().email('Invalid email')
z.string().url('Invalid URL')
z.string().regex(/^[a-z0-9_]+$/, 'Lowercase alphanumeric only')
```

### Number constraints

```typescript
z.number().int('Must be whole number')
z.number().positive('Must be > 0')
z.number().min(0, 'Cannot be negative')
z.number().max(100, 'Cannot exceed 100')
```

### Enums

```typescript
z.enum(['todo', 'in-progress', 'done'])
```

### Optional and nullable

```typescript
z.string().optional()                // field can be omitted
z.string().nullable()                // field can be null
z.string().optional().nullable()     // both
```

### Arrays

```typescript
z.array(z.string())
z.array(z.string()).min(1, 'At least one tag')
z.array(z.number()).max(100)
```

### Custom validation

```typescript
z.string().refine(
  (val) => /^[A-Z]/.test(val),
  'Must start with uppercase',
)
```

### Cross-field validation

```typescript
z.object({
  start_date: z.string(),
  end_date: z.string(),
}).refine(
  (data) => new Date(data.end_date) > new Date(data.start_date),
  'End date must be after start date',
)
```

**Important**: All validation must be synchronous. Async `.refine()` throws
`SchemaMustBeSynchronousError` at mutation time.

## Transformation Patterns

### String to Date

```typescript
// Insert-only (no update support)
z.string().transform((val) => new Date(val))

// Insert + update (required for update() to work)
z.union([z.string(), z.date()]).transform((val) =>
  typeof val === 'string' ? new Date(val) : val,
)
```

### Computed fields

```typescript
z.object({
  first_name: z.string(),
  last_name: z.string(),
}).transform((data) => ({
  ...data,
  full_name: `${data.first_name} ${data.last_name}`,
}))
```

### Sanitization

```typescript
z.object({
  email: z.string().email().transform((val) => val.toLowerCase().trim()),
  tags: z.array(z.string()).transform((val) => val.map((t) => t.toLowerCase())),
})
```

## Default Values

```typescript
const todoSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  completed: z.boolean().default(false),
  priority: z.number().default(0),
  tags: z.array(z.string()).default([]),
  created_at: z.date().default(() => new Date()),
})

// Insert with minimal fields — defaults fill the rest
collection.insert({ id: crypto.randomUUID(), text: 'Buy milk' })
```

Use function defaults (`default(() => new Date())`) for dynamic values.

## Error Handling

```typescript
import { SchemaValidationError } from '@tanstack/db'

try {
  collection.insert({ id: '1', email: 'not-an-email', age: -5 })
} catch (error) {
  if (error instanceof SchemaValidationError) {
    error.type    // 'insert' | 'update'
    error.issues  // [{ message: '...', path: ['email'] }, ...]

    error.issues.forEach((issue) => {
      const field = issue.path?.join('.') || 'unknown'
      showFieldError(field, issue.message)
    })
  }
}
```

## Type Inference

Let TypeScript infer types from the schema. Do not also pass a generic:

```typescript
const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
})

// Types inferred — do not add <Todo> generic
const collection = createCollection(
  queryCollectionOptions({
    schema: todoSchema,
    queryKey: ['todos'],
    queryFn: () => fetch('/api/todos').then((r) => r.json()),
    getKey: (item) => item.id, // item is typed from schema
  }),
)
```
