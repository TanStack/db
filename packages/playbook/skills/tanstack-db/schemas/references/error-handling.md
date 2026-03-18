# Schema Error Handling

Handle validation errors gracefully.

## SchemaValidationError

When validation fails, TanStack DB throws `SchemaValidationError`:

```tsx
import { SchemaValidationError } from '@tanstack/db'

try {
  collection.insert({
    id: '1',
    email: 'not-an-email',
    age: -5,
  })
} catch (error) {
  if (error instanceof SchemaValidationError) {
    console.log(error.type) // 'insert' or 'update'
    console.log(error.message) // "Validation failed with 2 issues"
    console.log(error.issues) // Array of validation issues
  }
}
```

## Error Structure

```tsx
error.issues = [
  {
    path: ['email'],
    message: 'Invalid email address',
  },
  {
    path: ['age'],
    message: 'Number must be greater than 0',
  },
]
```

## Displaying Errors in UI

```tsx
const handleSubmit = async (data: unknown) => {
  try {
    collection.insert(data)
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      error.issues.forEach((issue) => {
        const fieldName = issue.path?.join('.') || 'unknown'
        showFieldError(fieldName, issue.message)
      })
    }
  }
}
```

## React Form Example

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

      <button type="submit">Add Todo</button>
    </form>
  )
}
```

## Custom Error Messages

Provide helpful messages in your schema:

```tsx
const userSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(20, 'Username is too long (max 20 characters)')
    .regex(/^[a-zA-Z0-9_]+$/, 'Only letters, numbers, and underscores'),
  email: z.string().email('Please enter a valid email address'),
  age: z
    .number()
    .int('Age must be a whole number')
    .min(13, 'You must be at least 13 years old'),
})
```

## Nested Path Errors

For nested objects, path shows the full path:

```tsx
const schema = z.object({
  id: z.string(),
  address: z.object({
    street: z.string().min(1),
    city: z.string().min(1),
  }),
})

// Error for nested field
error.issues = [
  {
    path: ['address', 'city'], // Nested path
    message: 'String must contain at least 1 character(s)',
  },
]

// Access in UI
const fieldName = issue.path?.join('.') // "address.city"
```

## Array Errors

```tsx
const schema = z.object({
  id: z.string(),
  tags: z.array(z.string().min(1)),
})

// Error for array element
error.issues = [
  {
    path: ['tags', 2], // Index in array
    message: 'String must contain at least 1 character(s)',
  },
]
```

## Multiple Errors at Once

Schemas report all validation failures, not just the first:

```tsx
collection.insert({
  id: '1',
  email: 'bad',
  age: -5,
  status: 'invalid',
})

// error.issues contains all 3 failures
// Display all to user at once
```

## Preventing Common Issues

### Validate Before Insert

Sometimes you want to check validity without inserting:

```tsx
const todoSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
})

function validateTodo(data: unknown): boolean {
  const result = todoSchema.safeParse(data)
  return result.success
}

// Use before insert
if (validateTodo(formData)) {
  collection.insert(formData)
} else {
  showError('Invalid data')
}
```

### Type-Safe Form Data

```tsx
type TodoInput = z.input<typeof todoSchema>

function createTodo(data: TodoInput) {
  collection.insert(data) // Type-safe
}
```

## Error Recovery Pattern

```tsx
async function saveTodo(data: unknown) {
  try {
    collection.insert(data)
    return { success: true }
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      return {
        success: false,
        errors: Object.fromEntries(
          error.issues.map((i) => [i.path?.[0] || 'form', i.message]),
        ),
      }
    }
    throw error // Re-throw unexpected errors
  }
}
```
