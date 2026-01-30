---
name: tanstack-db-schemas
description: |
  Schema validation and type transformations in TanStack DB.
  Use for validation, TInput/TOutput types, transformations, defaults, and error handling.
---

# Schemas

TanStack DB uses schemas to validate and transform data during mutations. Schemas are optional but strongly recommended for type safety and data integrity.

## Supported Libraries

Any [StandardSchema](https://standardschema.dev) compatible library:
- [Zod](https://zod.dev)
- [Valibot](https://valibot.dev)
- [ArkType](https://arktype.io)
- [Effect Schema](https://effect.website/docs/schema/introduction/)

## Common Patterns

### Basic Validation

```tsx
import { z } from 'zod'
import { createCollection } from '@tanstack/react-db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

const todoSchema = z.object({
  id: z.string(),
  text: z.string().min(1, 'Text is required'),
  completed: z.boolean(),
  priority: z.number().min(0).max(5),
})

const collection = createCollection(
  queryCollectionOptions({
    schema: todoSchema,
    queryKey: ['todos'],
    queryFn: async () => api.todos.getAll(),
    getKey: (item) => item.id,
  })
)

// Invalid data throws SchemaValidationError
collection.insert({
  id: '1',
  text: '',        // ❌ Too short
  completed: 'yes', // ❌ Wrong type
  priority: 10,     // ❌ Out of range
})
```

### Default Values

```tsx
const todoSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  completed: z.boolean().default(false),
  priority: z.number().default(0),
  tags: z.array(z.string()).default([]),
  created_at: z.date().default(() => new Date()),
})

// Defaults filled automatically
collection.insert({
  id: '1',
  text: 'Buy groceries',
  // completed defaults to false
  // priority defaults to 0
  // tags defaults to []
  // created_at defaults to now
})
```

### Type Transformations

Transform input types to different output types:

```tsx
const eventSchema = z.object({
  id: z.string(),
  name: z.string(),
  // IMPORTANT: Accept both input AND output types
  start_time: z.union([z.string(), z.date()])
    .transform(val => typeof val === 'string' ? new Date(val) : val),
})

// Insert with string (TInput)
collection.insert({
  id: '1',
  name: 'Conference',
  start_time: '2024-06-15T10:00:00Z', // String in
})

// Get returns Date (TOutput)
const event = collection.get('1')
console.log(event.start_time.getFullYear()) // Date out!
```

### TInput vs TOutput (Critical Concept)

When transforming types, TInput MUST be a superset of TOutput for updates to work:

```tsx
// ❌ BAD: TInput only accepts string, but draft contains Date
const badSchema = z.object({
  created_at: z.string().transform(val => new Date(val))
})
// TInput:  { created_at: string }
// TOutput: { created_at: Date }
// Problem: collection.update() passes Date but schema expects string!

// ✅ GOOD: TInput accepts both string and Date
const goodSchema = z.object({
  created_at: z.union([z.string(), z.date()])
    .transform(val => typeof val === 'string' ? new Date(val) : val)
})
// TInput:  { created_at: string | Date }
// TOutput: { created_at: Date }
// Works: update draft.created_at is Date, which TInput accepts!
```

**Rule:** If you transform A → B, use `z.union([A, B])` as input.

### Validation Patterns

```tsx
// String constraints
z.string().min(3, 'Too short')
z.string().max(100, 'Too long')
z.string().email('Invalid email')
z.string().url('Invalid URL')
z.string().regex(/^[a-z]+$/, 'Lowercase only')

// Number constraints
z.number().int('Must be whole number')
z.number().positive('Must be positive')
z.number().min(0).max(100)

// Enums
z.enum(['low', 'medium', 'high'])

// Optional and nullable
z.string().optional()      // Can be omitted
z.string().nullable()      // Can be null
z.string().optional().nullable() // Either

// Arrays
z.array(z.string()).min(1, 'At least one required')

// Custom validation
z.string().refine(
  (val) => /^[a-zA-Z0-9_]+$/.test(val),
  'Only letters, numbers, underscores'
)

// Cross-field validation
z.object({
  start: z.date(),
  end: z.date(),
}).refine(
  (data) => data.end > data.start,
  'End must be after start'
)
```

### Error Handling

```tsx
import { SchemaValidationError } from '@tanstack/db'

try {
  collection.insert({
    id: '1',
    email: 'invalid',
    age: -5,
  })
} catch (error) {
  if (error instanceof SchemaValidationError) {
    console.log(error.type)    // 'insert' or 'update'
    console.log(error.message) // 'Validation failed with 2 issues'
    console.log(error.issues)  // Array of issues
    // [
    //   { path: ['email'], message: 'Invalid email' },
    //   { path: ['age'], message: 'Must be positive' }
    // ]
  }
}
```

### React Form Example

```tsx
function TodoForm() {
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setErrors({})

    try {
      todoCollection.insert({
        id: crypto.randomUUID(),
        text: e.currentTarget.text.value,
        priority: parseInt(e.currentTarget.priority.value),
      })
    } catch (error) {
      if (error instanceof SchemaValidationError) {
        const newErrors: Record<string, string> = {}
        error.issues.forEach((issue) => {
          const field = issue.path?.[0] || 'form'
          newErrors[field] = issue.message
        })
        setErrors(newErrors)
      }
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input name="text" />
      {errors.text && <span className="error">{errors.text}</span>}

      <input name="priority" type="number" />
      {errors.priority && <span className="error">{errors.priority}</span>}

      <button type="submit">Add</button>
    </form>
  )
}
```

### Schema with Computed Fields

```tsx
const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  base_price: z.number(),
  discount_percent: z.number().default(0),
}).transform((data) => ({
  ...data,
  final_price: data.base_price * (1 - data.discount_percent / 100),
  display_price: `$${(data.base_price * (1 - data.discount_percent / 100)).toFixed(2)}`,
}))

collection.insert({
  id: '1',
  name: 'Widget',
  base_price: 100,
  discount_percent: 10,
})

const product = collection.get('1')
console.log(product.final_price)   // 90
console.log(product.display_price) // '$90.00'
```

### Handlers Receive TOutput

Schema transforms happen BEFORE handlers run:

```tsx
const schema = z.object({
  id: z.string(),
  created_at: z.union([z.string(), z.date()])
    .transform(val => typeof val === 'string' ? new Date(val) : val),
})

const collection = createCollection({
  schema,
  onInsert: async ({ transaction }) => {
    const item = transaction.mutations[0].modified
    // item.created_at is already a Date (TOutput)!

    // If API needs string, serialize it
    await api.create({
      ...item,
      created_at: item.created_at.toISOString(),
    })
  },
})
```

## Important Notes

- Schemas validate **client mutations only** (insert/update), not server data
- TypeScript types are inferred from schema automatically
- If you provide a schema, don't also pass explicit type parameter
- Keep transformations simple—they run synchronously on every mutation

## Detailed References

| Reference                     | When to Use                                        |
| ----------------------------- | -------------------------------------------------- |
| `references/validation.md`    | Comprehensive validation patterns                  |
| `references/transformations.md` | Type transformations, computed fields            |
| `references/tinput-toutput.md` | Deep dive on TInput/TOutput relationship         |
| `references/error-handling.md` | SchemaValidationError, form integration          |
