# @tanstack/svelte-db

Svelte 5 integration for TanStack DB. See [TanStack/db](https://github.com/TanStack/db) for more details.

## Installation

```bash
npm install @tanstack/svelte-db @tanstack/db
# or
pnpm add @tanstack/svelte-db @tanstack/db
```

## Usage

```ts
import { useLiveQuery } from '@tanstack/svelte-db'
import { createCollection, eq } from '@tanstack/db'

const todosCollection = createCollection({...})

// Basic usage (recommended)
const todosQuery = useLiveQuery((q) =>
  q.from({ todos: todosCollection })
   .where(({ todos }) => eq(todos.completed, false))
)

// Access data via dot notation
console.log(todosQuery.data)       // Array of results
console.log(todosQuery.isLoading)  // Boolean
console.log(todosQuery.isReady)    // Boolean
```

## Important: Destructuring in Svelte 5

**Direct destructuring breaks reactivity.** This is a fundamental Svelte 5 limitation when working with objects that have getters.

### ❌ Incorrect (loses reactivity):

```ts
const { data, isLoading } = useLiveQuery(...)
// data and isLoading will NOT update reactively
```

### ✅ Correct patterns:

**Option 1: Use dot notation (recommended)**
```ts
const query = useLiveQuery(...)
// Access via: query.data, query.isLoading, query.isReady
```

**Option 2: Wrap with `$derived` for destructuring**
```ts
const query = useLiveQuery(...)
const { data, isLoading, isError } = $derived(query)
// Now data, isLoading, and isError maintain reactivity
```

This behavior is documented in [Svelte issue #11002](https://github.com/sveltejs/svelte/issues/11002).

## API Reference

See the main [TanStack DB documentation](https://github.com/TanStack/db) for more details on queries, collections, and other features.
