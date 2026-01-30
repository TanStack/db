# Schema Transformations

Transform data as it enters your collection.

## String to Date

Most common transformation - convert ISO strings to Date objects:

```tsx
const eventSchema = z.object({
  id: z.string(),
  name: z.string(),
  start_time: z
    .union([z.string(), z.date()])
    .transform((val) => (typeof val === 'string' ? new Date(val) : val)),
})

collection.insert({
  id: '1',
  name: 'Conference',
  start_time: '2024-06-15T10:00:00Z', // String in
})

const event = collection.get('1')
console.log(event.start_time.getFullYear()) // Date out
```

## String to Number

```tsx
const formSchema = z.object({
  id: z.string(),
  quantity: z
    .union([z.string(), z.number()])
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val)),
  price: z
    .union([z.string(), z.number()])
    .transform((val) => (typeof val === 'string' ? parseFloat(val) : val)),
})

collection.insert({
  id: '1',
  quantity: '42', // String from form input
  price: '19.99',
})

const item = collection.get('1')
console.log(typeof item.quantity) // "number"
```

## JSON String to Object

```tsx
const configSchema = z.object({
  id: z.string(),
  settings: z
    .union([z.string(), z.record(z.unknown())])
    .transform((val) => (typeof val === 'string' ? JSON.parse(val) : val)),
})

collection.insert({
  id: '1',
  settings: '{"theme":"dark","notifications":true}',
})

const config = collection.get('1')
console.log(config.settings.theme) // "dark"
```

## Computed Fields

```tsx
const userSchema = z
  .object({
    id: z.string(),
    first_name: z.string(),
    last_name: z.string(),
  })
  .transform((data) => ({
    ...data,
    full_name: `${data.first_name} ${data.last_name}`,
  }))

collection.insert({
  id: '1',
  first_name: 'John',
  last_name: 'Doe',
})

const user = collection.get('1')
console.log(user.full_name) // "John Doe"
```

## Sanitization

```tsx
const commentSchema = z.object({
  id: z.string(),
  text: z.string().transform((val) => val.trim()),
  username: z.string().transform((val) => val.toLowerCase()),
})
```

## Complex Transformations

```tsx
const productSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    price_cents: z.number(),
  })
  .transform((data) => ({
    ...data,
    price_dollars: data.price_cents / 100,
    display_price: `$${(data.price_cents / 100).toFixed(2)}`,
  }))
```

## Default Values

### Literal Defaults

```tsx
const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean().default(false),
  priority: z.number().default(0),
  tags: z.array(z.string()).default([]),
})

collection.insert({
  id: '1',
  text: 'Buy groceries',
  // completed, priority, tags filled automatically
})
```

### Function Defaults

```tsx
const postSchema = z.object({
  id: z.string(),
  title: z.string(),
  created_at: z.date().default(() => new Date()),
  slug: z.string().default(() => crypto.randomUUID()),
})
```

## Combining Defaults with Transformations

```tsx
const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean().default(false),
  created_at: z
    .union([z.string(), z.date()])
    .default(() => new Date())
    .transform((val) => (typeof val === 'string' ? new Date(val) : val)),
})
```

## Critical Rule: Union Types

**Always use union types** when transforming between types. This ensures TInput accepts both the input format AND the output format:

```tsx
// REQUIRED: Accept both string (new data) and Date (existing data)
const schema = z.object({
  created_at: z
    .union([z.string(), z.date()])
    .transform((val) => (typeof val === 'string' ? new Date(val) : val)),
})

// WILL BREAK: Updates fail because draft contains Date but schema only accepts string
const schema = z.object({
  created_at: z.string().transform((val) => new Date(val)),
})
```

See [TInput vs TOutput](./tinput-toutput.md) for why this is essential.

## Performance Note

Schema validation runs synchronously on every mutation. Keep transformations simple for high-frequency updates:

```tsx
// Avoid expensive operations in transforms
const schema = z.object({
  data: z.string().transform((val) => expensiveOperation(val)), // Slow
})

// Better: Validate only, process elsewhere when needed
const schema = z.object({
  data: z.string(),
})
```
