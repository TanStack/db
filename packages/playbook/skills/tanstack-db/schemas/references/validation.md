# Schema Validation

Validate data using StandardSchema-compatible libraries.

## Supported Libraries

- [Zod](https://zod.dev)
- [Valibot](https://valibot.dev)
- [ArkType](https://arktype.io)
- [Effect Schema](https://effect.website/docs/schema/introduction/)

## Basic Type Validation

```tsx
const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  age: z.number(),
  email: z.string().email(),
  active: z.boolean(),
})

collection.insert({
  id: '1',
  name: 'Alice',
  age: '25', // Wrong type - expects number
  email: 'not-an-email', // Invalid format
  active: true,
})
// Throws SchemaValidationError
```

## String Constraints

```tsx
const productSchema = z.object({
  id: z.string(),
  name: z.string().min(3, 'Name must be at least 3 characters'),
  sku: z.string().length(8, 'SKU must be exactly 8 characters'),
  description: z.string().max(500, 'Description too long'),
  url: z.string().url('Must be a valid URL'),
})
```

## Number Constraints

```tsx
const orderSchema = z.object({
  id: z.string(),
  quantity: z
    .number()
    .int('Must be a whole number')
    .positive('Must be greater than 0'),
  price: z
    .number()
    .min(0.01, 'Price must be at least $0.01')
    .max(999999.99, 'Price too high'),
  discount: z.number().min(0).max(100),
})
```

## Enum Validation

```tsx
const taskSchema = z.object({
  id: z.string(),
  status: z.enum(['todo', 'in-progress', 'done']),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
})

collection.insert({
  id: '1',
  status: 'completed', // Not in enum - fails
  priority: 'medium',
})
```

## Optional and Nullable Fields

```tsx
const personSchema = z.object({
  id: z.string(),
  name: z.string(),
  nickname: z.string().optional(), // Can be omitted
  middleName: z.string().nullable(), // Can be null
  bio: z.string().optional().nullable(), // Can be omitted OR null
})

// All valid:
collection.insert({ id: '1', name: 'Alice' })
collection.insert({ id: '2', name: 'Bob', middleName: null })
```

## Array Validation

```tsx
const postSchema = z.object({
  id: z.string(),
  title: z.string(),
  tags: z.array(z.string()).min(1, 'At least one tag required'),
  likes: z.array(z.number()).max(1000),
})
```

## Custom Validation

```tsx
const userSchema = z.object({
  id: z.string(),
  username: z
    .string()
    .min(3)
    .refine(
      (val) => /^[a-zA-Z0-9_]+$/.test(val),
      'Username can only contain letters, numbers, and underscores',
    ),
  password: z
    .string()
    .min(8)
    .refine(
      (val) => /[A-Z]/.test(val) && /[0-9]/.test(val),
      'Must contain uppercase letter and number',
    ),
})
```

## Cross-Field Validation

```tsx
const dateRangeSchema = z
  .object({
    id: z.string(),
    start_date: z.string(),
    end_date: z.string(),
  })
  .refine(
    (data) => new Date(data.end_date) > new Date(data.start_date),
    'End date must be after start date',
  )
```

## Schema Scope

**Important:** Schemas validate client changes only - data from `insert()` and `update()`. They do not automatically validate data loaded from your server. Validate server data explicitly in your integration layer if needed.

## Collection Setup

```tsx
const todoCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => api.todos.getAll(),
    getKey: (item) => item.id,
    schema: todoSchema, // Validates mutations
  }),
)
```

## Type Inference

```tsx
const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
})

type Todo = z.infer<typeof todoSchema>

// TypeScript knows item type automatically
const collection = createCollection(
  queryCollectionOptions({
    schema: todoSchema,
    getKey: (item) => item.id, // item is Todo
  }),
)
```
