---
title: Schemas
id: schemas
---

# Schema Validation and Type Transformations

TanStack DB uses schemas to ensure your data is valid and type-safe throughout your application.

## What You'll Learn

This guide covers:
- How schema validation works in TanStack DB
- Understanding TInput and TOutput types
- Common patterns: validation, transformations, and defaults
- Error handling and best practices

## Quick Example

Schemas catch invalid data before it enters your collection:

```typescript
import { z } from 'zod'
import { createCollection } from '@tanstack/react-db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

const todoSchema = z.object({
  id: z.string(),
  text: z.string().min(1, "Text is required"),
  completed: z.boolean(),
  priority: z.number().min(0).max(5)
})

const collection = createCollection(
  queryCollectionOptions({
    schema: todoSchema,
    queryKey: ['todos'],
    queryFn: async () => api.todos.getAll(),
    getKey: (item) => item.id,
    // ...
  })
)

// Invalid data throws SchemaValidationError
collection.insert({
  id: "1",
  text: "",  // ❌ Too short
  completed: "yes",  // ❌ Wrong type
  priority: 10  // ❌ Out of range
})
// Error: Validation failed with 3 issues

// Valid data works
collection.insert({
  id: "1",
  text: "Buy groceries",  // ✅
  completed: false,  // ✅
  priority: 2  // ✅
})
```

Schemas also enable advanced features like type transformations and defaults:

```typescript
const todoSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  completed: z.boolean().default(false),  // Auto-fill missing values
  created_at: z.string().transform(val => new Date(val))  // Convert types
})

collection.insert({
  id: "1",
  text: "Buy groceries",
  created_at: "2024-01-01T00:00:00Z"  // String in
  // completed auto-filled with false
})

const todo = collection.get("1")
console.log(todo.created_at.getFullYear())  // Date object out!
```

## Supported Schema Libraries

TanStack DB supports any [StandardSchema](https://standardschema.dev) compatible library:
- [Zod](https://zod.dev)
- [Valibot](https://valibot.dev)
- [ArkType](https://arktype.io)
- [Effect Schema](https://effect.website/docs/schema/introduction/)

Examples in this guide use Zod, but patterns apply to all libraries.

---

## Core Concepts: TInput vs TOutput

Understanding TInput and TOutput is key to working effectively with schemas in TanStack DB.

### What are TInput and TOutput?

When you define a schema with transformations, it has two types:

- **TInput**: The type users provide when calling `insert()` or `update()`
- **TOutput**: The type stored in the collection and returned from queries

```typescript
const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  created_at: z.string().transform(val => new Date(val))
})

// TInput type:  { id: string, text: string, created_at: string }
// TOutput type: { id: string, text: string, created_at: Date }
```

The schema acts as a **boundary** that transforms TInput → TOutput.

### Why This Matters

**All data in your collection is TOutput:**
- Data stored in the collection
- Data returned from queries
- Data in `PendingMutation.modified`
- Data in mutation handlers

```typescript
const collection = createCollection({
  schema: todoSchema,
  onInsert: async ({ transaction }) => {
    const item = transaction.mutations[0].modified

    // item is TOutput
    console.log(item.created_at instanceof Date)  // true

    // If your API needs a string, serialize it
    await api.todos.create({
      ...item,
      created_at: item.created_at.toISOString()  // Date → string
    })
  }
})

// User provides TInput
collection.insert({
  id: "1",
  text: "Task",
  created_at: "2024-01-01T00:00:00Z"  // string
})

// Collection stores and returns TOutput
const todo = collection.get("1")
console.log(todo.created_at.getFullYear())  // It's a Date!
```

### The Data Flow

Here's how data flows through the system:

```
┌─────────────────────────────────────────────────┐
│           User Code / API Response              │
│              (TInput format)                    │
│     { created_at: "2024-01-01T00:00:00Z" }    │
└────────────────────┬────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────┐
│         collection.insert(data)                 │
│                    or                           │
│         collection.validateData(data)           │
└────────────────────┬────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────┐
│      Schema Validation & Transformation         │
│              (TInput → TOutput)                 │
│                                                 │
│  1. Validate types and constraints              │
│  2. Apply transformations (.transform())        │
│  3. Apply defaults (.default())                 │
│  4. Return validated TOutput                    │
└────────────────────┬────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────┐
│           Collection Storage                    │
│             (TOutput format)                    │
│         { created_at: Date object }            │
└────────────────────┬────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────┐
│      Queries / Reads / Mutation Handlers        │
│             (TOutput format)                    │
│         { created_at: Date object }            │
└─────────────────────────────────────────────────┘
```

**Key points:**
1. Schema validation happens at the **collection boundary**
2. **Everything inside the collection is TOutput**
3. Validation runs during `insert()`, `update()`, and `validateData()`

---

## Validation Patterns

Schemas provide powerful validation to ensure data quality.

### Basic Type Validation

```typescript
const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  age: z.number(),
  email: z.string().email(),
  active: z.boolean()
})

collection.insert({
  id: "1",
  name: "Alice",
  age: "25",  // ❌ Wrong type - expects number
  email: "not-an-email",  // ❌ Invalid email format
  active: true
})
// Throws SchemaValidationError
```

### String Constraints

```typescript
const productSchema = z.object({
  id: z.string(),
  name: z.string().min(3, "Name must be at least 3 characters"),
  sku: z.string().length(8, "SKU must be exactly 8 characters"),
  description: z.string().max(500, "Description too long"),
  url: z.string().url("Must be a valid URL")
})
```

### Number Constraints

```typescript
const orderSchema = z.object({
  id: z.string(),
  quantity: z.number()
    .int("Must be a whole number")
    .positive("Must be greater than 0"),
  price: z.number()
    .min(0.01, "Price must be at least $0.01")
    .max(999999.99, "Price too high"),
  discount: z.number()
    .min(0)
    .max(100)
})
```

### Enum Validation

```typescript
const taskSchema = z.object({
  id: z.string(),
  status: z.enum(['todo', 'in-progress', 'done']),
  priority: z.enum(['low', 'medium', 'high', 'urgent'])
})

collection.insert({
  id: "1",
  status: "completed",  // ❌ Not in enum
  priority: "medium"  // ✅
})
```

### Optional and Nullable Fields

```typescript
const personSchema = z.object({
  id: z.string(),
  name: z.string(),
  nickname: z.string().optional(),  // Can be omitted
  middleName: z.string().nullable(),  // Can be null
  bio: z.string().optional().nullable()  // Can be omitted OR null
})

// All valid:
collection.insert({ id: "1", name: "Alice" })  // nickname omitted
collection.insert({ id: "2", name: "Bob", middleName: null })
collection.insert({ id: "3", name: "Carol", bio: null })
```

### Array Validation

```typescript
const postSchema = z.object({
  id: z.string(),
  title: z.string(),
  tags: z.array(z.string()).min(1, "At least one tag required"),
  likes: z.array(z.number()).max(1000)
})

collection.insert({
  id: "1",
  title: "My Post",
  tags: [],  // ❌ Need at least one
  likes: [1, 2, 3]
})
```

### Custom Validation

```typescript
const userSchema = z.object({
  id: z.string(),
  username: z.string()
    .min(3)
    .refine(
      (val) => /^[a-zA-Z0-9_]+$/.test(val),
      "Username can only contain letters, numbers, and underscores"
    ),
  password: z.string()
    .min(8)
    .refine(
      (val) => /[A-Z]/.test(val) && /[0-9]/.test(val),
      "Password must contain at least one uppercase letter and one number"
    )
})
```

### Cross-Field Validation

```typescript
const dateRangeSchema = z.object({
  id: z.string(),
  start_date: z.string(),
  end_date: z.string()
}).refine(
  (data) => new Date(data.end_date) > new Date(data.start_date),
  "End date must be after start date"
)
```

---

## Transformation Patterns

Schemas can transform data as it enters your collection.

### String to Date

The most common transformation - convert ISO strings to Date objects:

```typescript
const eventSchema = z.object({
  id: z.string(),
  name: z.string(),
  start_time: z.string().transform(val => new Date(val))
})

collection.insert({
  id: "1",
  name: "Conference",
  start_time: "2024-06-15T10:00:00Z"  // TInput: string
})

const event = collection.get("1")
console.log(event.start_time.getFullYear())  // TOutput: Date
```

### String to Number

```typescript
const formSchema = z.object({
  id: z.string(),
  quantity: z.string().transform(val => parseInt(val, 10)),
  price: z.string().transform(val => parseFloat(val))
})

collection.insert({
  id: "1",
  quantity: "42",  // String from form input
  price: "19.99"
})

const item = collection.get("1")
console.log(typeof item.quantity)  // "number"
```

### JSON String to Object

```typescript
const configSchema = z.object({
  id: z.string(),
  settings: z.string().transform(val => JSON.parse(val))
})

collection.insert({
  id: "1",
  settings: '{"theme":"dark","notifications":true}'  // JSON string
})

const config = collection.get("1")
console.log(config.settings.theme)  // "dark" (parsed object)
```

### Computed Fields

```typescript
const userSchema = z.object({
  id: z.string(),
  first_name: z.string(),
  last_name: z.string()
}).transform(data => ({
  ...data,
  full_name: `${data.first_name} ${data.last_name}`  // Computed
}))

collection.insert({
  id: "1",
  first_name: "John",
  last_name: "Doe"
})

const user = collection.get("1")
console.log(user.full_name)  // "John Doe"
```

### String to Enum

```typescript
const orderSchema = z.object({
  id: z.string(),
  status: z.string().transform(val =>
    val.toUpperCase() as 'PENDING' | 'SHIPPED' | 'DELIVERED'
  )
})
```

### Sanitization

```typescript
const commentSchema = z.object({
  id: z.string(),
  text: z.string().transform(val => val.trim()),  // Remove whitespace
  username: z.string().transform(val => val.toLowerCase())  // Normalize
})
```

### Complex Transformations

```typescript
const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  price_cents: z.number()
}).transform(data => ({
  ...data,
  price_dollars: data.price_cents / 100,  // Add computed field
  display_price: `$${(data.price_cents / 100).toFixed(2)}`  // Formatted
}))
```

---

## Default Values

Schemas can automatically provide default values for missing fields.

### Literal Defaults

```typescript
const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean().default(false),
  priority: z.number().default(0),
  tags: z.array(z.string()).default([])
})

collection.insert({
  id: "1",
  text: "Buy groceries"
  // completed, priority, and tags filled automatically
})

const todo = collection.get("1")
console.log(todo.completed)  // false
console.log(todo.priority)   // 0
console.log(todo.tags)       // []
```

### Function Defaults

Generate defaults dynamically:

```typescript
const postSchema = z.object({
  id: z.string(),
  title: z.string(),
  created_at: z.date().default(() => new Date()),
  view_count: z.number().default(0),
  slug: z.string().default(() => crypto.randomUUID())
})

collection.insert({
  id: "1",
  title: "My First Post"
  // created_at, view_count, and slug generated automatically
})
```

### Conditional Defaults

```typescript
const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  role: z.enum(['user', 'admin']).default('user'),
  permissions: z.array(z.string()).default(['read'])
})
```

### Complex Defaults

```typescript
const eventSchema = z.object({
  id: z.string(),
  name: z.string(),
  metadata: z.record(z.unknown()).default(() => ({
    created_by: 'system',
    version: 1
  }))
})
```

### Combining Defaults with Transformations

```typescript
const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean().default(false),
  created_at: z.string()
    .default(() => new Date().toISOString())
    .transform(val => new Date(val))
})

collection.insert({
  id: "1",
  text: "Task"
  // completed defaults to false
  // created_at defaults to current time, then transforms to Date
})
```

---

## Handling Updates

When updating data, your schema needs to handle both new input (TInput) and existing data (already TOutput).

### The Challenge

Consider this schema:

```typescript
const todoSchema = z.object({
  id: z.string(),
  created_at: z.string().transform(val => new Date(val))
})
```

**Problem:** During updates, `created_at` is already a Date (TOutput), but the transform expects a string (TInput). The validation will fail!

```typescript
// Initial insert works
collection.insert({
  id: "1",
  created_at: "2024-01-01T00:00:00Z"  // string → Date
})

// Update fails!
collection.update("1", (draft) => {
  draft.text = "Updated"
  // draft.created_at is already a Date, but schema expects string
})
```

### Solution: Union Types

Accept both the input type and the output type:

```typescript
const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  created_at: z.union([
    z.string(),  // Accept string (new input)
    z.date()     // Accept Date (existing data)
  ]).transform(val =>
    typeof val === 'string' ? new Date(val) : val
  )
})
```

Now both inserts and updates work:

```typescript
// Insert with string (TInput)
collection.insert({
  id: "1",
  text: "Task",
  created_at: "2024-01-01T00:00:00Z"  // string
})

// Update works - created_at is already a Date
collection.update("1", (draft) => {
  draft.text = "Updated"  // created_at stays as Date
})

// Can also update with a new string
collection.update("1", (draft) => {
  draft.updated_at = "2024-01-02T00:00:00Z"  // string → Date
})
```

### Pattern: Union Transform Helper

For schemas with many date fields, create a helper:

```typescript
const dateField = z.union([
  z.string(),
  z.date()
]).transform(val => typeof val === 'string' ? new Date(val) : val)

const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  created_at: dateField,
  updated_at: dateField,
  completed_at: dateField.optional()
})
```

### When You Don't Need Unions

If your schema doesn't have transformations, you don't need unions:

```typescript
const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean().default(false),
  priority: z.number().default(0)
})

// TInput === TOutput (no transformations)
// Updates work fine without unions
```

### Optional Fields in Updates

For partial updates, use `.partial()`:

```typescript
const insertSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  age: z.number()
})

const updateSchema = insertSchema.partial()

// Now all fields except id are optional for updates
collection.update("1", { name: "Updated Name" })  // OK
```

---

## Error Handling

When validation fails, TanStack DB throws a `SchemaValidationError` with detailed information.

### Basic Error Handling

```typescript
import { SchemaValidationError } from '@tanstack/db'

try {
  collection.insert({
    id: "1",
    email: "not-an-email",
    age: -5
  })
} catch (error) {
  if (error instanceof SchemaValidationError) {
    console.log(error.type)     // 'insert' or 'update'
    console.log(error.message)  // "Validation failed with 2 issues"
    console.log(error.issues)   // Array of validation issues
  }
}
```

### Error Structure

```typescript
error.issues = [
  {
    path: ['email'],
    message: 'Invalid email address'
  },
  {
    path: ['age'],
    message: 'Number must be greater than 0'
  }
]
```

### Displaying Errors in UI

```typescript
const handleSubmit = async (data: unknown) => {
  try {
    collection.insert(data)
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      // Show errors by field
      error.issues.forEach(issue => {
        const fieldName = issue.path?.join('.') || 'unknown'
        showFieldError(fieldName, issue.message)
      })
    }
  }
}
```

### React Example

```tsx
import { SchemaValidationError } from '@tanstack/db'

function TodoForm() {
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setErrors({})

    try {
      todoCollection.insert({
        id: crypto.randomUUID(),
        text: e.currentTarget.text.value,
        priority: parseInt(e.currentTarget.priority.value)
      })
    } catch (error) {
      if (error instanceof SchemaValidationError) {
        const newErrors: Record<string, string> = {}
        error.issues.forEach(issue => {
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

      <button type="submit">Add Todo</button>
    </form>
  )
}
```

### Handling Sync Validation Errors

When syncing data into your collection, handle validation errors gracefully:

```typescript
sync: {
  sync: ({ write, begin, commit, collection }) => {
    const data = await fetchFromAPI()

    begin()
    for (const item of data) {
      try {
        const validated = collection.validateData(item, 'insert')
        write({ type: 'insert', value: validated })
      } catch (error) {
        if (error instanceof SchemaValidationError) {
          // Log but don't stop sync
          console.error(`Invalid data from server:`, item, error.issues)
          continue  // Skip this item
        }
        throw error  // Re-throw other errors
      }
    }
    commit()
  }
}
```

### Safe Parsing (Zod)

For cases where you want a result type instead of throwing:

```typescript
const result = todoSchema.safeParse(data)

if (result.success) {
  collection.insert(result.data)
} else {
  console.error(result.error.issues)
}
```

---

## Best Practices

### When to Use Schemas

✅ **Use schemas when you want:**
- Runtime validation of user input
- Type transformations (string → Date, etc.)
- Automatic default values
- Better TypeScript inference
- Validation error messages

❌ **You might not need schemas if:**
- Your data is already validated (e.g., from a type-safe backend)
- You don't need transformations or defaults
- Performance is critical and validation would be a bottleneck

### Keep Transformations Simple

> **Performance Note:** Schema validation is synchronous and runs on every optimistic mutation. For high-frequency updates, keep transformations simple.

```typescript
// ❌ Avoid expensive operations
const schema = z.object({
  data: z.string().transform(val => {
    // Heavy computation on every mutation
    return expensiveParsingOperation(val)
  })
})

// ✅ Better: Validate only, process elsewhere
const schema = z.object({
  data: z.string()  // Simple validation
})

// Process in component or mutation handler when needed
const processedData = expensiveParsingOperation(todo.data)
```

### Use Union Types for Updates

Always use union types when transforming to different output types:

```typescript
// ✅ Good: Handles both input and existing data
const schema = z.object({
  created_at: z.union([z.string(), z.date()])
    .transform(val => typeof val === 'string' ? new Date(val) : val)
})

// ❌ Bad: Will fail on updates
const schema = z.object({
  created_at: z.string().transform(val => new Date(val))
})
```

### Validate at the Boundary

Let the collection schema handle validation. Don't duplicate validation logic:

```typescript
// ❌ Avoid: Duplicate validation
function addTodo(text: string) {
  if (!text || text.length < 3) {
    throw new Error("Text too short")
  }
  todoCollection.insert({ id: "1", text })
}

// ✅ Better: Let schema handle it
const todoSchema = z.object({
  id: z.string(),
  text: z.string().min(3, "Text must be at least 3 characters")
})
```

### Type Inference

Let TypeScript infer types from your schema:

```typescript
const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean()
})

type Todo = z.infer<typeof todoSchema>  // Inferred type

// ✅ Use the inferred type
const collection = createCollection(
  queryCollectionOptions({
    schema: todoSchema,
    // TypeScript knows the item type automatically
    getKey: (item) => item.id  // item is Todo
  })
)
```

### Custom Error Messages

Provide helpful error messages for users:

```typescript
const userSchema = z.object({
  username: z.string()
    .min(3, "Username must be at least 3 characters")
    .max(20, "Username is too long (max 20 characters)")
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
  email: z.string().email("Please enter a valid email address"),
  age: z.number()
    .int("Age must be a whole number")
    .min(13, "You must be at least 13 years old")
})
```

### Schema Organization

For large schemas, organize by domain:

```typescript
// schemas/user.ts
export const userSchema = z.object({
  id: z.string(),
  username: z.string().min(3),
  email: z.string().email()
})

// schemas/todo.ts
export const todoSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  user_id: z.string()
})

// collections/todos.ts
import { todoSchema } from '../schemas/todo'

export const todoCollection = createCollection(
  queryCollectionOptions({
    schema: todoSchema,
    // ...
  })
)
```

---

## Full-Context Examples

### Example 1: Todo App with Rich Types

A complete todo application demonstrating validation, transformations, and defaults:

```typescript
import { z } from 'zod'
import { createCollection } from '@tanstack/react-db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

// Schema with validation, transformations, and defaults
const todoSchema = z.object({
  id: z.string(),
  text: z.string().min(1, "Todo text cannot be empty"),
  completed: z.boolean().default(false),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  due_date: z.union([
    z.string(),
    z.date()
  ]).transform(val => typeof val === 'string' ? new Date(val) : val).optional(),
  created_at: z.union([
    z.string(),
    z.date()
  ]).transform(val => typeof val === 'string' ? new Date(val) : val)
    .default(() => new Date()),
  tags: z.array(z.string()).default([])
})

type Todo = z.infer<typeof todoSchema>

// Collection setup
const todoCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => {
      const response = await fetch('/api/todos')
      const todos = await response.json()
      // API returns ISO strings for dates
      return todos
    },
    getKey: (item) => item.id,
    schema: todoSchema,
    queryClient,

    onInsert: async ({ transaction }) => {
      const todo = transaction.mutations[0].modified

      // Serialize dates for API
      await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...todo,
          due_date: todo.due_date?.toISOString(),
          created_at: todo.created_at.toISOString()
        })
      })
    },

    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map(async (mutation) => {
          const { original, changes } = mutation

          // Serialize any date fields in changes
          const serialized = {
            ...changes,
            due_date: changes.due_date instanceof Date
              ? changes.due_date.toISOString()
              : changes.due_date
          }

          await fetch(`/api/todos/${original.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(serialized)
          })
        })
      )
    },

    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map(async (mutation) => {
          await fetch(`/api/todos/${mutation.original.id}`, {
            method: 'DELETE'
          })
        })
      )
    }
  })
)

// Component usage
function TodoApp() {
  const { data: todos } = useLiveQuery(q =>
    q.from({ todo: todoCollection })
      .where(({ todo }) => !todo.completed)
      .orderBy(({ todo }) => todo.created_at, 'desc')
  )

  const [errors, setErrors] = useState<Record<string, string>>({})

  const addTodo = (text: string, priority: 'low' | 'medium' | 'high') => {
    try {
      todoCollection.insert({
        id: crypto.randomUUID(),
        text,
        priority,
        due_date: "2024-12-31T23:59:59Z"
        // completed, created_at, tags filled automatically by defaults
      })
      setErrors({})
    } catch (error) {
      if (error instanceof SchemaValidationError) {
        const newErrors: Record<string, string> = {}
        error.issues.forEach(issue => {
          const field = issue.path?.[0] || 'form'
          newErrors[field] = issue.message
        })
        setErrors(newErrors)
      }
    }
  }

  const toggleComplete = (todo: Todo) => {
    todoCollection.update(todo.id, (draft) => {
      draft.completed = !draft.completed
    })
  }

  return (
    <div>
      <h1>Todos</h1>

      {errors.text && <div className="error">{errors.text}</div>}

      <button onClick={() => addTodo("Buy groceries", "high")}>
        Add Todo
      </button>

      <ul>
        {todos?.map(todo => (
          <li key={todo.id}>
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={() => toggleComplete(todo)}
            />
            <span>{todo.text}</span>
            <span>Priority: {todo.priority}</span>
            {todo.due_date && (
              <span>Due: {todo.due_date.toLocaleDateString()}</span>
            )}
            <span>Created: {todo.created_at.toLocaleDateString()}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

### Example 2: E-commerce Product with Computed Fields

```typescript
import { z } from 'zod'

// Schema with computed fields and transformations
const productSchema = z.object({
  id: z.string(),
  name: z.string().min(3, "Product name must be at least 3 characters"),
  description: z.string().max(500, "Description too long"),
  base_price: z.number().positive("Price must be positive"),
  tax_rate: z.number().min(0).max(1).default(0.1),
  discount_percent: z.number().min(0).max(100).default(0),
  stock: z.number().int().min(0).default(0),
  category: z.enum(['electronics', 'clothing', 'food', 'other']),
  tags: z.array(z.string()).default([]),
  created_at: z.union([z.string(), z.date()])
    .transform(val => typeof val === 'string' ? new Date(val) : val)
    .default(() => new Date())
}).transform(data => ({
  ...data,
  // Computed fields
  final_price: data.base_price * (1 + data.tax_rate) * (1 - data.discount_percent / 100),
  in_stock: data.stock > 0,
  display_price: `$${(data.base_price * (1 + data.tax_rate) * (1 - data.discount_percent / 100)).toFixed(2)}`
}))

type Product = z.infer<typeof productSchema>

const productCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['products'],
    queryFn: async () => api.products.getAll(),
    getKey: (item) => item.id,
    schema: productSchema,
    queryClient,

    onInsert: async ({ transaction }) => {
      const product = transaction.mutations[0].modified

      // API only needs base fields, not computed ones
      await api.products.create({
        name: product.name,
        description: product.description,
        base_price: product.base_price,
        tax_rate: product.tax_rate,
        discount_percent: product.discount_percent,
        stock: product.stock,
        category: product.category,
        tags: product.tags
      })
    }
  })
)

// Usage
function ProductList() {
  const { data: products } = useLiveQuery(q =>
    q.from({ product: productCollection })
      .where(({ product }) => product.in_stock)  // Use computed field
      .orderBy(({ product }) => product.final_price, 'asc')
  )

  const addProduct = () => {
    productCollection.insert({
      id: crypto.randomUUID(),
      name: "Wireless Mouse",
      description: "Ergonomic wireless mouse",
      base_price: 29.99,
      discount_percent: 10,
      category: "electronics",
      stock: 50
      // tax_rate, tags, created_at filled by defaults
      // final_price, in_stock, display_price computed automatically
    })
  }

  return (
    <div>
      {products?.map(product => (
        <div key={product.id}>
          <h3>{product.name}</h3>
          <p>{product.description}</p>
          <p>Price: {product.display_price}</p>
          <p>Stock: {product.in_stock ? `${product.stock} available` : 'Out of stock'}</p>
          <p>Category: {product.category}</p>
        </div>
      ))}
    </div>
  )
}
```

---

## For Integration Authors

If you're creating a custom collection options creator (like `electricCollectionOptions` or `trailbaseCollectionOptions`), you need to understand how schemas interact with your sync layer.

### Two Type Conversion Mechanisms

There are **two separate but complementary** type conversion mechanisms:

1. **Your integration's parsing** (storage format ↔ in-memory format)
   - Example: Unix timestamp → Date, WKB → GeoJSON
   - Layer: Sync (during `write()`)
   - Your responsibility as integration author

2. **User schemas** (TInput → TOutput for mutations)
   - Example: ISO string → Date, validation, defaults
   - Layer: Mutations (during `insert()`/`update()`)
   - User's choice

### How They Work Together

```typescript
// 1. User defines schema
const todoSchema = z.object({
  created_at: z.string().transform(val => new Date(val))
})

// 2. Your integration handles storage format
export function myCollectionOptions(config) {
  return {
    // Parse from storage format (e.g., Unix timestamp → Date)
    sync: {
      sync: ({ write, collection }) => {
        const storageRow = { id: "1", created_at: 1704067200 }  // Unix timestamp

        // Your parsing layer
        const parsed = {
          ...storageRow,
          created_at: new Date(storageRow.created_at * 1000)  // → Date
        }

        // Validate with user's schema (if provided)
        const validated = collection.validateData(parsed, 'insert')

        // Write TOutput to collection
        write({ type: 'insert', value: validated })
      }
    },

    // Serialize for storage format
    onInsert: async ({ transaction }) => {
      const item = transaction.mutations[0].modified  // TOutput (Date)

      // Your serialization layer
      const serialized = {
        ...item,
        created_at: Math.floor(item.created_at.valueOf() / 1000)  // Date → Unix
      }

      await storage.write(serialized)
    }
  }
}
```

### Best Practices for Integration Authors

1. **Always call `collection.validateData()`** when syncing data into the collection
2. **Don't constrain user schemas** to match your storage types - let users define rich TOutput
3. **Handle serialization in mutation handlers** when persisting to your storage
4. **Document your storage formats** so users know what to expect

### Complete Example

See the [Collection Options Creator Guide](./collection-options-creator.md) for comprehensive documentation on creating integrations, including detailed guidance on handling schemas.

---

## Related Topics

- **[Mutations Guide](./mutations.md)** - Learn about optimistic mutations and how schemas validate mutation data
- **[Error Handling Guide](./error-handling.md)** - Comprehensive guide to handling `SchemaValidationError` and other errors
- **[Collection Options Creator Guide](./collection-options-creator.md)** - For integration authors: creating custom collection types with schema support
- **[StandardSchema Specification](https://standardschema.dev)** - Full specification for StandardSchema v1
