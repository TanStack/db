# Paced Mutations Demo

This example demonstrates the `usePacedMutations` hook with different timing strategies and validation patterns.

## Examples Included

### 1. Strategies Demo (Default)

Demonstrates how different timing strategies work:
- **Debounce**: Waits for inactivity before persisting
- **Queue**: Processes mutations sequentially (FIFO)
- **Throttle**: Ensures minimum spacing between executions

### 2. Email Draft Example with Zod Validation

A comprehensive example showing how to use `usePacedMutations` with Zod schema validation for type-safe, validated mutations.

**Features:**
- ✅ Zod discriminated union for different action types
- ✅ Type-safe mutation inputs with TypeScript
- ✅ Runtime validation before applying optimistic updates
- ✅ Debounced updates for real-time editing
- ✅ Clear separation of concerns with action-based mutations

**Actions demonstrated:**
```typescript
// Insert a new draft
debouncedMutateEmail({
  action: 'insert-draft',
  id: 'draft-1',
  to: 'user@example.com',
  subject: 'Important Meeting',
  body: 'Hi there...'
})

// Update the title/subject
debouncedMutateEmail({
  action: 'update-title',
  id: 'draft-1',
  subject: 'Updated subject'
})

// Update the body
debouncedMutateEmail({
  action: 'update-body',
  id: 'draft-1',
  body: 'Updated body text'
})
```

## Running the Example

```bash
# From the repository root
npm run dev --workspace=@tanstack/db-example-paced-mutations-demo

# Or from this directory
npm run dev
```

## Key Concepts

### Zod Validation with usePacedMutations

The email draft example shows how to:

1. **Define a discriminated union schema:**
```typescript
const emailMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("insert-draft"),
    // ... other fields
  }),
  z.object({
    action: z.literal("update-title"),
    // ... other fields
  }),
  // ... more actions
])
```

2. **Validate in onMutate:**
```typescript
const mutate = usePacedMutations<EmailMutation>({
  onMutate: (variables) => {
    // Validate before applying optimistic updates
    const validated = emailMutationSchema.parse(variables)

    // Apply optimistic updates based on action type
    if (validated.action === "insert-draft") {
      collection.insert(validated)
    } else if (validated.action === "update-title") {
      collection.update(validated.id, draft => {
        draft.subject = validated.subject
      })
    }
  },
  mutationFn: async ({ transaction }) => {
    // Persist to server
  },
  strategy: debounceStrategy({ wait: 1000 })
})
```

3. **Get full type safety:**
```typescript
type EmailMutation = z.infer<typeof emailMutationSchema>

// TypeScript ensures correct fields for each action
mutate({ action: 'update-title', id: 'draft-1', subject: 'New' }) // ✅
mutate({ action: 'update-title', id: 'draft-1', body: 'Oops' })    // ❌ TypeScript error
```

## Files

- `src/App.tsx` - Main app with strategies demo
- `src/EmailDraftExample.tsx` - Email draft example with Zod validation
- `src/main.tsx` - Entry point
- `src/index.css` - Styles

## Learn More

- [usePacedMutations Documentation](../../../docs/guides/mutations.md)
- [Zod Documentation](https://zod.dev)
