# @TanStack/optimistic

A core library for creating fast optimistic updates with flexible backend support.

## Installation

```bash
pnpm add @TanStack/optimistic
```

## Overview

`@TanStack/optimistic` provides a robust solution for managing data synchronization between your frontend application and backend services. It offers:

- **Optimistic Updates**: Apply changes instantly in the UI while syncing in the background
- **Flexible Backend Support**: Works with any backend or sync engine
- **Immutable Snapshots**: Create immutable snapshots of updates that can be persisted and rolled back

## Core Concepts

### Collections

Collections are the central concept in `@TanStack/optimistic`. A collection represents a set of data that can be synchronized, queried, and modified. Each collection:

- Has a unique identifier
- Contains data items
- Provides CRUD operations (insert, update, delete)
- Manages its own sync and persistence logic

### Transactions

All mutations in `@TanStack/optimistic` are handled through transactions. Transactions:

- Group related changes together
- Track the state of mutations (pending, persisting, completed, failed)
- Support rollback in case of errors
- Provide optimistic updates to the UI

### Proxies

The library uses proxies to create immutable snapshots and track changes:

- Deep change tracking at any level of object nesting
- Special handling for various types (Date, RegExp, Map, Set)
- Circular reference handling with WeakMap cache

## Framework Adapters

This is a core package that provides the fundamental optimistic update functionality. For most applications, you'll want to use this package with a framework-specific adapter:

- `@TanStack/react-optimistic` - React adapter with hooks for easy integration
- Other framework adapters (coming soon)

The framework adapters provide idiomatic ways to use the core optimistic update functionality within your chosen framework.

## API Reference

### Data Operations

#### Insert

```typescript
// Insert a single item
insert({ text: "Buy groceries", completed: false })

// Insert multiple items
insert([
  { text: "Buy groceries", completed: false },
  { text: "Walk dog", completed: false },
])

// Insert with custom key
insert({ text: "Buy groceries" }, { key: "grocery-task" })
```

#### Update

We use a proxy to capture updates as immutable draft optimistic updates.

```typescript
// Update a single item
update(todo, (draft) => {
  draft.completed = true
})

// Update multiple items
update([todo1, todo2], (drafts) => {
  drafts.forEach((draft) => {
    draft.completed = true
  })
})

// Update with metadata
update(todo, { metadata: { reason: "user update" } }, (draft) => {
  draft.text = "Updated text"
})
```

#### Delete

```typescript
// Delete a single item
delete todo

// Delete multiple items
delete [todo1, todo2]

// Delete with metadata
delete (todo, { metadata: { reason: "completed" } })
```

### Schema Validation

Collections can optionally include a [standard schema](https://github.com/standard-schema/standard-schema) for data validation:

```typescript
const todoCollection = createCollection({
  id: "todos",
  sync: {
    /* sync config */
  },
  mutationFn: {
    /* mutation functions */
  },
  schema: todoSchema, // Standard schema interface
})
```

## Transaction Management

The library includes a simple yet powerful transaction management system. Transactions are created using the `createTransaction` function:

```typescript
const tx = createTransaction({
  mutationFn: async ({ transaction }) => {
    // Implement your mutation logic here
    // This function is called when the transaction is committed
  },
})

// Apply mutations within the transaction
tx.mutate(() => {
  // All collection operations (insert/update/delete) within this callback
  // will be part of this transaction
})
```

Transactions progress through several states:

1. `pending`: Initial state when a transaction is created
2. `persisting`: Transaction is being persisted to the backend
3. `completed`: Transaction has been successfully persisted
4. `failed`: An error was thrown while persisting or syncing back the Transaction
