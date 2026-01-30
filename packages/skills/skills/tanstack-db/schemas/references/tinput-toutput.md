# TInput vs TOutput

Critical concept for schemas with transformations.

## What Are They?

When a schema has transformations, it has two types:

- **TInput**: Type users provide when calling `insert()` or `update()`
- **TOutput**: Type stored in collection and returned from queries

```tsx
const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  created_at: z.string().transform(val => new Date(val))
})

// TInput:  { id: string, text: string, created_at: string }
// TOutput: { id: string, text: string, created_at: Date }
```

## Critical Rule: TInput Must Be Superset of TOutput

When using transformations, **TInput must accept all values that TOutput contains**. This is essential for updates to work.

### Why?

When you call `collection.update(id, (draft) => {...})`:
1. The `draft` parameter contains data that's already been transformed (TOutput)
2. After your modifications, it goes back through the schema
3. The schema must accept the transformed data

### Bad Pattern

```tsx
// TInput only accepts strings
const schema = z.object({
  created_at: z.string().transform(val => new Date(val))
})
// TInput:  { created_at: string }
// TOutput: { created_at: Date }

// Problem: draft.created_at is a Date, but TInput only accepts string!
collection.update("1", (draft) => {
  draft.text = "Updated"
  // draft.created_at is Date - schema rejects it!
})
```

### Good Pattern

```tsx
// TInput accepts both string and Date
const schema = z.object({
  created_at: z.union([z.string(), z.date()])
    .transform(val => typeof val === 'string' ? new Date(val) : val)
})
// TInput:  { created_at: string | Date }
// TOutput: { created_at: Date }

// Works: draft.created_at (Date) is accepted by TInput
collection.update("1", (draft) => {
  draft.text = "Updated"
  // draft.created_at passes through unchanged
})
```

## Rule of Thumb

If your schema transforms type A to type B, use `z.union([A, B])` to ensure TInput accepts both.

## Where TOutput Appears

All data in your collection is TOutput:
- Data stored in the collection
- Data returned from queries
- Data in `PendingMutation.modified`
- Data in mutation handlers

```tsx
const collection = createCollection({
  schema: todoSchema,
  onInsert: async ({ transaction }) => {
    const item = transaction.mutations[0].modified

    // item is TOutput - created_at is Date
    console.log(item.created_at instanceof Date)  // true

    // Serialize for API
    await api.todos.create({
      ...item,
      created_at: item.created_at.toISOString()  // Date -> string
    })
  }
})
```

## Insert vs Update Flow

### Insert

```tsx
// User provides TInput
collection.insert({
  id: "1",
  text: "Task",
  created_at: "2024-01-01T00:00:00Z"  // string (TInput)
})

// Schema transforms to TOutput
// Collection stores: { ..., created_at: Date }
```

### Update

```tsx
// Draft contains TOutput
collection.update("1", (draft) => {
  // draft.created_at is already a Date (TOutput)
  draft.text = "Updated task"
})

// After modification, goes through schema again
// TInput must accept Date for this to work
```

## Common Patterns

### Date Fields

```tsx
const schema = z.object({
  created_at: z.union([z.string(), z.date()])
    .transform(val => typeof val === 'string' ? new Date(val) : val)
    .default(() => new Date()),
  updated_at: z.union([z.string(), z.date()])
    .transform(val => typeof val === 'string' ? new Date(val) : val)
    .default(() => new Date())
})
```

### Number from String (Forms)

```tsx
const schema = z.object({
  quantity: z.union([z.string(), z.number()])
    .transform(val => typeof val === 'string' ? parseInt(val, 10) : val)
})
```

### JSON Fields

```tsx
const schema = z.object({
  metadata: z.union([z.string(), z.record(z.unknown())])
    .transform(val => typeof val === 'string' ? JSON.parse(val) : val)
})
```

## Debugging TInput Issues

If updates fail with validation errors, check:

1. Does your schema transform types?
2. Does TInput accept TOutput values?
3. Add union type to accept both formats

```tsx
// Before (broken)
z.string().transform(val => new Date(val))

// After (fixed)
z.union([z.string(), z.date()])
  .transform(val => typeof val === 'string' ? new Date(val) : val)
```
