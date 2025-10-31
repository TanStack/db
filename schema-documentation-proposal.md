# Schema Documentation Proposal

## Current State Analysis

### What's Currently Documented

**overview.md (lines 144-154):**
- Basic mention that collections support schemas (StandardSchema compatible)
- States schemas are used for "client-side validation of optimistic mutations"
- Notes you can't provide both a schema and an explicit type
- Shows basic usage: `schema: todoSchema`

**mutations.md (lines 495-560):**
- Shows schema validation for **action parameters** (validating inputs to `createOptimisticAction`)
- Does NOT cover TInput/TOutput transformations for collection data

### Critical Gaps

1. ❌ **No explanation of TInput vs TOutput** - The core concept is missing
2. ❌ **No transformation examples** - No `.transform()` usage shown
3. ❌ **No default value examples** - No `.default()` usage shown
4. ❌ **No data flow explanation** - Where does validation happen in the system?
5. ❌ **No type conversion patterns** - Common patterns like Date handling, enums, computed fields
6. ❌ **No integration guidance** - How integrations should handle serialization/deserialization
7. ❌ **No best practices** - When to use schemas, what to transform, performance considerations

---

## Proposed Solution: New Dedicated Guide

**Create: `docs/guides/schemas.md`**

This deserves its own guide because:
- It's a substantial topic spanning mutations, queries, and sync
- It's relevant to all collection types
- It affects integration authors and app developers differently
- Discoverability is important for this foundational concept

---

## Proposed Content Structure

### 1. Introduction & Core Concepts (5-10 min read)

**Title:** "Schema Validation and Type Transformations"

**Opening:**
- What schemas do in TanStack DB
- Why you should use them (type safety, runtime validation, data transformation)
- Overview of StandardSchema compatibility (Zod, Valibot, ArkType, Effect)

**Core Concept: TInput vs TOutput**
```typescript
// Example showing the concept clearly
const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
  created_at: z.string().transform(val => new Date(val)),  // TInput: string, TOutput: Date
  priority: z.number().default(0)  // TInput: optional, TOutput: always present
})

// TInput = { id: string, text: string, completed: boolean, created_at: string, priority?: number }
// TOutput = { id: string, text: string, completed: boolean, created_at: Date, priority: number }
```

**Explain:**
- TInput: What users provide when calling `insert()` or `update()`
- TOutput: What gets stored in the collection and returned from queries
- Schema transforms TInput → TOutput at the collection boundary

---

### 2. The Data Flow (visual diagram + explanation)

**Include a diagram showing:**

```
┌─────────────────────────────────────────────────────────────────┐
│                         User's Code                              │
└──────────────────────────┬──────────────────────────────────────┘
                           │ TInput (strings, partial data)
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│                  collection.insert(data)                         │
│                           ↓                                      │
│              Schema Validation & Transformation                  │
│                     (TInput → TOutput)                           │
│                           ↓                                      │
│              - Validate types and constraints                    │
│              - Apply transformations (.transform())              │
│              - Apply defaults (.default())                       │
│              - Convert types (string → Date, etc.)               │
└──────────────────────────┬──────────────────────────────────────┘
                           │ TOutput (Dates, complete data)
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Collection Storage                            │
│                  (stores as TOutput)                             │
└──────────────────────────┬──────────────────────────────────────┘
                           │ TOutput
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Live Queries / Reads                          │
│                  (returns TOutput)                               │
└─────────────────────────────────────────────────────────────────┘
```

**Key Points:**
1. Validation happens at the **collection boundary** (during `insert()`, `update()`, and sync writes)
2. **Everything stored in the collection is TOutput**
3. **Everything read from the collection is TOutput**
4. PendingMutations also store TOutput

---

### 3. Transformation Examples

**3.1 Type Conversions**

**Example: String to Date**
```typescript
const eventSchema = z.object({
  id: z.string(),
  name: z.string(),
  start_time: z.string().transform(val => new Date(val))
})

const collection = createCollection({
  schema: eventSchema,
  // ...
})

// User provides string
collection.insert({
  id: "1",
  name: "Conference",
  start_time: "2024-01-01T10:00:00Z"  // TInput: string
})

// Collection stores Date
const event = collection.get("1")
console.log(event.start_time.getFullYear())  // TOutput: Date
```

**Example: Number/String to Enum**
```typescript
const statusSchema = z.object({
  id: z.string(),
  status: z.union([
    z.literal('draft'),
    z.literal('published'),
    z.literal('archived')
  ]).default('draft')
})
```

**Example: Computed Fields**
```typescript
const userSchema = z.object({
  id: z.string(),
  first_name: z.string(),
  last_name: z.string(),
}).transform(data => ({
  ...data,
  full_name: `${data.first_name} ${data.last_name}`  // Computed during insert
}))
```

**3.2 Default Values**

```typescript
const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean().default(false),
  created_at: z.date().default(() => new Date()),
  priority: z.number().default(0),
  tags: z.array(z.string()).default([])
})

// User can omit fields with defaults
collection.insert({
  id: "1",
  text: "Buy groceries"
  // completed, created_at, priority, tags will be added automatically
})
```

**3.3 Input Validation & Constraints**

```typescript
const productSchema = z.object({
  id: z.string(),
  name: z.string().min(3, "Name must be at least 3 characters"),
  price: z.number().positive("Price must be positive"),
  email: z.string().email("Invalid email address"),
  age: z.number().int().min(18).max(120)
})

// This will throw SchemaValidationError
collection.insert({
  id: "1",
  name: "A",  // Too short
  price: -10,  // Negative
  email: "not-an-email",  // Invalid format
  age: 200  // Out of range
})
```

---

### 4. Handling Updates with Schemas

**The Challenge with Updates:**
When updating, existing data is already TOutput (e.g., Date objects), but users provide TInput (strings). You need to handle both.

**Pattern: Union Types**
```typescript
const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  created_at: z.union([z.string(), z.date()])
    .transform(val => typeof val === 'string' ? new Date(val) : val),
  updated_at: z.union([z.string(), z.date()])
    .transform(val => typeof val === 'string' ? new Date(val) : val)
})

const collection = createCollection({
  schema: todoSchema,
  // ...
})

// Insert with string (TInput)
collection.insert({
  id: "1",
  text: "Task",
  created_at: "2024-01-01T00:00:00Z"  // string
})

// Update merges with existing data (which has Date)
collection.update("1", (draft) => {
  draft.updated_at = new Date()  // Can use Date OR string
  // created_at is already a Date from the insert
})
```

**Why This Works:**
1. During insert: String input → validated → transformed to Date → stored as TOutput
2. During update: Schema merges partial update with existing TOutput, validates the merged result
3. Union type accepts both string (from user input) and Date (from existing data)

---

### 5. Integration-Specific Guidance

**5.1 For App Developers**

**When to Use Schemas:**
- ✅ Always use schemas when available - they provide type safety and runtime validation
- ✅ Define rich TOutput types (Date objects, enums, computed fields)
- ✅ Let the schema handle transformations rather than manual conversion

**Example: Rich Types in TOutput**
```typescript
// Good: Let users provide strings, store as Date
const schema = z.object({
  created_at: z.string().transform(val => new Date(val))
})

// Bad: Forcing users to provide Date objects
const schema = z.object({
  created_at: z.date()  // Users must call `new Date()` themselves
})
```

**5.2 For Integration Authors (Electric, PowerSync, RxDB, etc.)**

**Key Principle:** Your integration layer handles serialization between storage format and TOutput.

```typescript
// Integration Flow

// 1. Syncing FROM storage TO TanStack DB
sync: ({ write, collection }) => {
  // Read from storage (e.g., SQLite)
  const sqliteRow = { id: "1", created_at: "2024-01-01T00:00:00Z" }

  // Deserialize using schema: SQLite format → TOutput
  const transformed = collection.validateData(sqliteRow, 'insert')
  // Result: { id: "1", created_at: Date }

  // Write TOutput to collection
  write({ type: 'insert', value: transformed })
}

// 2. Persisting FROM TanStack DB TO storage
onInsert: async ({ transaction }) => {
  const item = transaction.mutations[0].modified  // This is TOutput

  // Serialize: TOutput → storage format
  const sqliteRow = {
    ...item,
    created_at: item.created_at.toISOString()  // Date → string
  }

  // Write to storage
  await db.execute("INSERT INTO ...", sqliteRow)
}
```

**Important:**
- ✅ Call `collection.validateData()` when syncing data INTO the collection
- ✅ Manually serialize TOutput when persisting data FROM the collection
- ❌ Don't constrain TOutput to match storage types
- ❌ Don't skip schema validation during sync

---

### 6. Common Patterns & Best Practices

**6.1 Date Handling**
```typescript
// Pattern: Accept strings, store as Date
const schema = z.object({
  timestamp: z.string().transform(val => new Date(val))
})

// Pattern: Accept both for updates
const schema = z.object({
  timestamp: z.union([z.string(), z.date()])
    .transform(val => typeof val === 'string' ? new Date(val) : val)
})
```

**6.2 Timestamps with Defaults**
```typescript
const schema = z.object({
  id: z.string(),
  created_at: z.date().default(() => new Date()),
  updated_at: z.date().default(() => new Date())
})

// Usage
collection.insert({
  id: "1"
  // timestamps added automatically
})
```

**6.3 Type-Safe Enums**
```typescript
const schema = z.object({
  status: z.enum(['draft', 'published', 'archived']).default('draft')
})
```

**6.4 Nullable/Optional Fields**
```typescript
const schema = z.object({
  id: z.string(),
  notes: z.string().optional(),  // TInput: string | undefined, TOutput: string | undefined
  deleted_at: z.date().nullable().default(null)  // TInput: Date | null, TOutput: Date | null
})
```

**6.5 Arrays with Defaults**
```typescript
const schema = z.object({
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).default({})
})
```

---

### 7. Performance Considerations

**Schema Validation Cost:**
- Schema validation runs on every `insert()` and `update()`
- Also runs during sync when calling `validateData()`
- For high-frequency updates, consider simpler schemas

**Optimization Tips:**
```typescript
// Avoid expensive transforms in hot paths
const schema = z.object({
  id: z.string(),
  data: z.string().transform(val => JSON.parse(val))  // Can be slow
})

// Better: Parse only when needed
const schema = z.object({
  id: z.string(),
  data: z.string()  // Store as string, parse in components
})
```

---

### 8. Error Handling

**Schema Validation Errors:**
```typescript
import { SchemaValidationError } from '@tanstack/db'

try {
  collection.insert({
    id: "1",
    email: "invalid-email",
    age: -5
  })
} catch (error) {
  if (error instanceof SchemaValidationError) {
    console.log(error.type)  // 'insert' or 'update'
    console.log(error.issues)  // Array of validation issues

    error.issues.forEach(issue => {
      console.log(issue.path)  // ['email'] or ['age']
      console.log(issue.message)  // "Invalid email address"
    })
  }
}
```

**In Sync Handlers:**
```typescript
sync: ({ write, begin, commit }) => {
  begin()
  for (const row of sqliteData) {
    try {
      const validated = collection.validateData(row, 'insert')
      write({ type: 'insert', value: validated })
    } catch (error) {
      if (error instanceof SchemaValidationError) {
        // Handle invalid data from storage
        console.error('Invalid data in storage:', error.issues)
        continue  // Skip this row
      }
      throw error
    }
  }
  commit()
}
```

---

### 9. Complete Working Examples

**Example 1: Todo App with Rich Types**
```typescript
const todoSchema = z.object({
  id: z.string(),
  text: z.string().min(1, "Todo text cannot be empty"),
  completed: z.boolean().default(false),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  due_date: z.string().transform(val => new Date(val)).optional(),
  created_at: z.date().default(() => new Date()),
  tags: z.array(z.string()).default([])
})

const todoCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => api.todos.getAll(),
    getKey: (item) => item.id,
    schema: todoSchema,
    onInsert: async ({ transaction }) => {
      const todo = transaction.mutations[0].modified  // TOutput

      // Serialize for API
      await api.todos.create({
        ...todo,
        due_date: todo.due_date?.toISOString(),  // Date → string
        created_at: todo.created_at.toISOString()
      })
    }
  })
)

// Usage - users provide simple inputs
todoCollection.insert({
  id: crypto.randomUUID(),
  text: "Buy groceries",
  due_date: "2024-12-31T23:59:59Z"
  // completed, priority, created_at, tags filled automatically
})

// Reading returns rich types
const todo = todoCollection.get(id)
console.log(todo.due_date.getTime())  // It's a Date!
console.log(todo.priority)  // Type-safe enum
```

**Example 2: E-commerce Product with Computed Fields**
```typescript
const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  base_price: z.number().positive(),
  tax_rate: z.number().min(0).max(1).default(0.1),
  discount_percent: z.number().min(0).max(100).default(0)
}).transform(data => ({
  ...data,
  // Computed field
  final_price: data.base_price * (1 + data.tax_rate) * (1 - data.discount_percent / 100)
}))

// User provides base data
collection.insert({
  id: "1",
  name: "Widget",
  base_price: 100,
  discount_percent: 20
  // tax_rate defaults to 0.1
})

// Reading returns computed field
const product = collection.get("1")
console.log(product.final_price)  // 88 (100 * 1.1 * 0.8)
```

---

### 10. Related Topics

**See Also:**
- [Mutations Guide](./mutations.md) - Using schemas with mutation handlers
- [Error Handling Guide](./error-handling.md) - Handling SchemaValidationError
- [Creating Collection Options](./collection-options-creator.md) - Integration authors: handling schemas in custom integrations
- [StandardSchema Specification](https://standardschema.dev) - Full schema specification

---

## Changes to Existing Docs

### 1. Update `overview.md` (lines 144-154)

**Replace:**
```markdown
#### Collection schemas

All collections optionally (though strongly recommended) support adding a `schema`.

If provided, this must be a [Standard Schema](https://standardschema.dev) compatible schema instance, such as a [Zod](https://zod.dev) or [Effect](https://effect.website/docs/schema/introduction/) schema.

The collection will use the schema to do client-side validation of optimistic mutations.

The collection will use the schema for its type so if you provide a schema, you can't also pass in an explicit
type (e.g. `createCollection<Todo>()`).
```

**With:**
```markdown
#### Collection schemas

All collections optionally (though strongly recommended) support adding a `schema`.

If provided, this must be a [Standard Schema](https://standardschema.dev) compatible schema instance, such as [Zod](https://zod.dev), [Valibot](https://valibot.dev), [ArkType](https://arktype.io), or [Effect](https://effect.website/docs/schema/introduction/) schemas.

Schemas provide three key benefits:

1. **Runtime validation**: Ensures data meets your constraints before entering the collection
2. **Type transformations**: Convert input types (strings) to rich output types (Date objects)
3. **Default values**: Automatically populate missing fields

The collection will use the schema for its type, so if you provide a schema, you can't also pass in an explicit
type parameter (e.g., `createCollection<Todo>()`).

For a comprehensive guide on schema validation and type transformations, see the [Schemas guide](../guides/schemas.md).
```

### 2. Add to `mutations.md` (after line 154)

Add a note in the mutation handlers section:

```markdown
> [!TIP]
> Schemas automatically validate and transform data during mutations. For example, you can use schemas to convert string inputs to Date objects. See the [Schemas guide](./schemas.md) for details on schema validation and type transformations.
```

### 3. Update `collection-options-creator.md` (after line 66)

Add a section on schemas:

```markdown
### 3. Schema Handling

When implementing a collection options creator for a sync engine, you must handle schema transformations correctly:

```typescript
// When syncing FROM storage TO TanStack DB
sync: ({ write, collection }) => {
  const storageData = await fetchFromStorage()

  // Deserialize: storage format → TOutput
  const transformed = collection.validateData(storageData, 'insert')

  // Write TOutput to collection
  write({ type: 'insert', value: transformed })
}

// When persisting FROM TanStack DB TO storage
onInsert: async ({ transaction }) => {
  const item = transaction.mutations[0].modified  // TOutput

  // Serialize: TOutput → storage format
  const serialized = serializeForStorage(item)

  // Write to storage
  await storage.write(serialized)
}
```

**Key principles:**
- Your integration layer handles serialization between storage format and TOutput
- Always call `collection.validateData()` when syncing data INTO the collection
- Manually serialize when persisting data FROM the collection to storage
- Don't constrain user schemas to match storage types

For a comprehensive guide, see [Schemas guide](./schemas.md#integration-specific-guidance).
```

---

## Implementation Checklist

- [ ] Create `docs/guides/schemas.md` with the content above
- [ ] Update `overview.md` collection schemas section
- [ ] Add schema tip to `mutations.md`
- [ ] Add schema handling section to `collection-options-creator.md`
- [ ] Add link to schemas guide in docs navigation
- [ ] Review and test all code examples
- [ ] Get feedback from integration authors (Electric, PowerSync, TrailBase teams)

---

## Success Metrics

After implementation, developers should be able to:

1. ✅ Explain the difference between TInput and TOutput
2. ✅ Use schema transformations to convert types (e.g., string → Date)
3. ✅ Apply default values in schemas
4. ✅ Handle both input and existing data in update schemas
5. ✅ Understand where schema validation happens in the system
6. ✅ (Integration authors) Correctly implement serialization/deserialization

This should significantly reduce confusion like the PowerSync team experienced.
