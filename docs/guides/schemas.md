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

Schemas catch invalid data from optimistic mutations before it enters your collection:

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

> **Important:** Schemas validate **client changes only** - data you insert or update via `collection.insert()` and `collection.update()`. They do not automatically validate data loaded from your server or sync layer. If you need to validate server data, you must do so explicitly in your integration layer.

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

### Critical Design Principle: TInput Must Be a Superset of TOutput

When using transformations, **TInput must accept all values that TOutput contains**. This is essential for updates to work correctly.

Here's why: when you call `collection.update(id, (draft) => {...})`, the `draft` parameter is typed as `TInput` but contains data that's already been transformed to `TOutput`. For this to work without complex type gymnastics, your schema must accept both the input format AND the output format.

```typescript
// ❌ BAD: TInput only accepts strings
const schema = z.object({
  created_at: z.string().transform(val => new Date(val))
})
// TInput:  { created_at: string }
// TOutput: { created_at: Date }
// Problem: draft.created_at is a Date, but TInput only accepts string!

// ✅ GOOD: TInput accepts both string and Date (superset of TOutput)
const schema = z.object({
  created_at: z.union([z.string(), z.date()])
    .transform(val => typeof val === 'string' ? new Date(val) : val)
})
// TInput:  { created_at: string | Date }
// TOutput: { created_at: Date }
// Success: draft.created_at can be a Date because TInput accepts Date!
```

**Rule of thumb:** If your schema transforms type A to type B, use `z.union([A, B])` to ensure TInput accepts both.

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

## Handling Timestamps

When working with timestamps, you typically want automatic creation dates rather than transforming user input.

### Use Defaults for Timestamps

For `created_at` and `updated_at` fields, use defaults to automatically generate timestamps:

```typescript
const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean().default(false),
  created_at: z.date().default(() => new Date()),
  updated_at: z.date().default(() => new Date())
})

// Timestamps generated automatically
collection.insert({
  id: "1",
  text: "Buy groceries"
  // created_at and updated_at filled automatically
})

// Update timestamps
collection.update("1", (draft) => {
  draft.text = "Buy groceries and milk"
  draft.updated_at = new Date()
})
```

### Accepting Date Input from External Sources

If you're accepting date input from external sources (forms, APIs), you must use union types to accept both strings and Date objects. This ensures TInput is a superset of TOutput:

```typescript
const eventSchema = z.object({
  id: z.string(),
  name: z.string(),
  scheduled_for: z.union([
    z.string(),  // Accept ISO string from form input (part of TInput)
    z.date()     // Accept Date from existing data (TOutput) or programmatic input
  ]).transform(val =>
    typeof val === 'string' ? new Date(val) : val
  )
})
// TInput:  { scheduled_for: string | Date }
// TOutput: { scheduled_for: Date }
// ✅ TInput is a superset of TOutput (accepts both string and Date)

// Works with string input (new data)
collection.insert({
  id: "1",
  name: "Meeting",
  scheduled_for: "2024-12-31T15:00:00Z"  // From form input
})

// Works with Date input (programmatic)
collection.insert({
  id: "2",
  name: "Workshop",
  scheduled_for: new Date()
})

// Updates work - scheduled_for is already a Date, and TInput accepts Date
collection.update("1", (draft) => {
  draft.name = "Updated Meeting"
  // draft.scheduled_for is a Date and can be used or modified
})
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

---

## Best Practices

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

### Use Union Types for Transformations (Essential)

When your schema transforms data to a different type, you **must** use union types to ensure TInput is a superset of TOutput. This is not optional - updates will fail without it.

```typescript
// ✅ REQUIRED: TInput accepts both string (new data) and Date (existing data)
const schema = z.object({
  created_at: z.union([z.string(), z.date()])
    .transform(val => typeof val === 'string' ? new Date(val) : val)
})
// TInput: { created_at: string | Date }
// TOutput: { created_at: Date }

// ❌ WILL BREAK: Updates fail because draft contains Date but TInput only accepts string
const schema = z.object({
  created_at: z.string().transform(val => new Date(val))
})
// TInput: { created_at: string }
// TOutput: { created_at: Date }
// Problem: collection.update() passes a Date to a schema expecting string!
```

**Why this is required:** During `collection.update()`, the `draft` object contains TOutput data (already transformed). The schema must accept this data, which means TInput must be a superset of TOutput.

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
      // Reuse schema to parse and transform API responses
      return todos.map((todo: any) => todoSchema.parse(todo))
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

If you're building a custom collection (like Electric or TrailBase), you'll need to handle data parsing and serialization between your storage format and the in-memory collection format. This is separate from schema validation, which happens during client mutations.

See the [Collection Options Creator Guide](./collection-options-creator.md) for comprehensive documentation on creating custom collection integrations, including how to handle schemas, data parsing, and type transformations.

---

## Related Topics

- **[Mutations Guide](./mutations.md)** - Learn about optimistic mutations and how schemas validate mutation data
- **[Error Handling Guide](./error-handling.md)** - Comprehensive guide to handling `SchemaValidationError` and other errors
- **[Collection Options Creator Guide](./collection-options-creator.md)** - For integration authors: creating custom collection types with schema support
- **[StandardSchema Specification](https://standardschema.dev)** - Full specification for StandardSchema v1
