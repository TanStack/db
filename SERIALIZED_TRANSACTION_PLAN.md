# Implementation Plan for `useSerializedTransaction` with TanStack Pacer

Based on [GitHub issue #35](https://github.com/TanStack/db/issues/35), using @tanstack/pacer for strategy implementation across all 5 framework integrations.

## Overview

Create a framework-agnostic core in `@tanstack/db` that manages optimistic transactions with pluggable queuing strategies powered by TanStack Pacer. Each framework package wraps the core with framework-specific reactive primitives.

## Architecture Pattern

The core transaction logic stays in one place (`@tanstack/db`) while each framework provides its own wrapper using framework-specific reactive primitives.

```typescript
// Core in @tanstack/db (framework-agnostic)
createSerializedTransaction(config) // Returns { mutate, cleanup }

// React wrapper
useSerializedTransaction(config) // Uses React hooks, returns mutate function

// Solid wrapper
useSerializedTransaction(config) // Uses Solid signals, matches useLiveQuery pattern

// Svelte/Vue wrappers
useSerializedTransaction(config) // Framework-specific implementations

// Angular wrapper
injectSerializedTransaction(config) // Uses Angular DI, follows injectLiveQuery pattern
```

## Available Strategies (Based on Pacer Utilities)

### 1. **debounceStrategy({ wait, leading?, trailing? })**

- Uses Pacer's `Debouncer` class
- Waits for pause in activity before committing
- **Best for:** Search inputs, auto-save fields

### 2. **queueStrategy({ wait?, maxSize?, addItemsTo?, getItemsFrom? })**

- Uses Pacer's `Queuer` class
- Processes all transactions in order (FIFO/LIFO)
- FIFO: `{ addItemsTo: 'back', getItemsFrom: 'front' }`
- LIFO: `{ addItemsTo: 'back', getItemsFrom: 'back' }`
- **Best for:** Sequential operations that must all complete

### 3. **throttleStrategy({ wait, leading?, trailing? })**

- Uses Pacer's `Throttler` class
- Evenly spaces transaction executions over time
- **Best for:** Sliders, scroll handlers, progress bars

### 4. **batchStrategy({ maxSize?, wait?, getShouldExecute? })**

- Uses Pacer's `Batcher` class
- Groups multiple mutations into batches
- Triggers on size or time threshold
- **Best for:** Bulk operations, reducing network calls

## File Structure

```
packages/db/src/
  ├── serialized-transaction.ts         # Core framework-agnostic logic
  └── strategies/
      ├── index.ts                      # Export all strategies
      ├── debounceStrategy.ts           # Wraps Pacer Debouncer
      ├── queueStrategy.ts              # Wraps Pacer Queuer
      ├── throttleStrategy.ts           # Wraps Pacer Throttler
      ├── batchStrategy.ts              # Wraps Pacer Batcher
      └── types.ts                      # Strategy type definitions

packages/db/package.json                # Add @tanstack/pacer dependency

packages/react-db/src/
  └── useSerializedTransaction.ts       # React hook wrapper

packages/solid-db/src/
  └── useSerializedTransaction.ts       # Solid wrapper (matches useLiveQuery pattern)

packages/svelte-db/src/
  └── useSerializedTransaction.svelte.ts # Svelte wrapper

packages/vue-db/src/
  └── useSerializedTransaction.ts       # Vue wrapper

packages/angular-db/src/
  └── injectSerializedTransaction.ts    # Angular wrapper (DI pattern)

packages/*/tests/
  └── serialized-transaction.test.ts    # Tests per package
```

## Core API Design

```typescript
// Framework-agnostic core (packages/db)
import { debounceStrategy } from '@tanstack/db'

const { mutate, cleanup } = createSerializedTransaction({
  mutationFn: async ({ transaction }) => {
    await api.save(transaction.mutations)
  },
  strategy: debounceStrategy({ wait: 500 }),
  metadata?: Record<string, unknown>,
})

// mutate() executes mutations according to strategy and returns Transaction
const transaction = mutate(() => {
  collection.update(id, draft => { draft.value = newValue })
})

// Await persistence and handle errors
try {
  await transaction.isPersisted.promise
  console.log('Transaction committed successfully')
} catch (error) {
  console.error('Transaction failed:', error)
}

// cleanup() when done (frameworks handle this automatically)
cleanup()
```

## React Hook Wrapper

```typescript
// packages/react-db
import { debounceStrategy } from "@tanstack/react-db"

const mutate = useSerializedTransaction({
  mutationFn: async ({ transaction }) => {
    await api.save(transaction.mutations)
  },
  strategy: debounceStrategy({ wait: 1000 }),
})

// Usage in component
const handleChange = async (value) => {
  const tx = mutate(() => {
    collection.update(id, (draft) => {
      draft.value = value
    })
  })

  // Optional: await persistence or handle errors
  try {
    await tx.isPersisted.promise
  } catch (error) {
    console.error("Update failed:", error)
  }
}
```

## Example: Slider with Different Strategies

```typescript
// Debounce - wait for user to stop moving slider
const mutate = useSerializedTransaction({
  mutationFn: async ({ transaction }) => {
    await api.updateVolume(transaction.mutations)
  },
  strategy: debounceStrategy({ wait: 500 }),
})

// Throttle - update every 200ms while sliding
const mutate = useSerializedTransaction({
  mutationFn: async ({ transaction }) => {
    await api.updateVolume(transaction.mutations)
  },
  strategy: throttleStrategy({ wait: 200 }),
})

// Debounce with leading/trailing - save first + final value only
const mutate = useSerializedTransaction({
  mutationFn: async ({ transaction }) => {
    await api.updateVolume(transaction.mutations)
  },
  strategy: debounceStrategy({ wait: 0, leading: true, trailing: true }),
})

// Queue - save every change in order (FIFO)
const mutate = useSerializedTransaction({
  mutationFn: async ({ transaction }) => {
    await api.updateVolume(transaction.mutations)
  },
  strategy: queueStrategy({
    wait: 200,
    addItemsTo: "back",
    getItemsFrom: "front",
  }),
})
```

## Implementation Steps

### Phase 1: Core Package (@tanstack/db)

1. Add `@tanstack/pacer` dependency to packages/db/package.json
2. Create strategy type definitions in strategies/types.ts
3. Implement strategy factories:
   - `debounceStrategy.ts` - wraps Pacer Debouncer
   - `queueStrategy.ts` - wraps Pacer Queuer
   - `throttleStrategy.ts` - wraps Pacer Throttler
   - `batchStrategy.ts` - wraps Pacer Batcher
4. Create core `createSerializedTransaction()` function
5. Export strategies + core function from packages/db/src/index.ts

### Phase 2: Framework Wrappers

6. **React** - Create `useSerializedTransaction` using useRef/useEffect/useCallback
7. **Solid** - Create `useSerializedTransaction` using createSignal/onCleanup (matches `useLiveQuery` pattern)
8. **Svelte** - Create `useSerializedTransaction` using Svelte stores
9. **Vue** - Create `useSerializedTransaction` using ref/onUnmounted
10. **Angular** - Create `injectSerializedTransaction` using inject/DestroyRef (matches `injectLiveQuery` pattern)

### Phase 3: Testing & Documentation

11. Write tests for core logic in packages/db
12. Write tests for each framework wrapper
13. Update README with examples
14. Add TypeScript examples to docs

## Strategy Type System

```typescript
export type Strategy =
  | DebounceStrategy
  | QueueStrategy
  | ThrottleStrategy
  | BatchStrategy

interface BaseStrategy<TName extends string = string> {
  _type: TName // Discriminator for type narrowing
  execute: (fn: () => void) => void | Promise<void>
  cleanup: () => void
}

export function debounceStrategy(opts: {
  wait: number
  leading?: boolean
  trailing?: boolean
}): DebounceStrategy

export function queueStrategy(opts?: {
  wait?: number
  maxSize?: number
  addItemsTo?: "front" | "back"
  getItemsFrom?: "front" | "back"
}): QueueStrategy

export function throttleStrategy(opts: {
  wait: number
  leading?: boolean
  trailing?: boolean
}): ThrottleStrategy

export function batchStrategy(opts?: {
  maxSize?: number
  wait?: number
  getShouldExecute?: (items: any[]) => boolean
}): BatchStrategy
```

## Technical Implementation Details

### Core createSerializedTransaction

The core function will:

1. Accept a strategy and mutationFn
2. Create a wrapper around `createTransaction` from existing code
3. Use the strategy's `execute()` method to control when transactions are committed
4. Return `{ mutate, cleanup }` where:
   - `mutate(callback): Transaction` - executes mutations according to strategy and returns the Transaction object
   - `cleanup()` - cleans up strategy resources

**Important:** The `mutate()` function returns a `Transaction` object so callers can:

- Await `transaction.isPersisted.promise` to know when persistence completes
- Handle errors via try/catch or `.catch()`
- Access transaction state and metadata

### Strategy Factories

Each strategy factory returns an object with:

- `execute(fn)` - wraps the function with Pacer's utility
- `cleanup()` - cleans up the Pacer instance

Example for debounceStrategy:

```typescript
// NOTE: Import path needs validation - Pacer may export from main entry point
// Likely: import { Debouncer } from '@tanstack/pacer' or similar
import { Debouncer } from "@tanstack/pacer" // TODO: Validate actual export path

export function debounceStrategy(opts: {
  wait: number
  leading?: boolean
  trailing?: boolean
}) {
  const debouncer = new Debouncer(opts)

  return {
    _type: "debounce" as const,
    execute: (fn: () => void) => {
      debouncer.execute(fn)
    },
    cleanup: () => {
      debouncer.cancel()
    },
  }
}
```

### React Hook Implementation

```typescript
export function useSerializedTransaction(config) {
  // Include strategy in dependencies to handle strategy changes
  const { mutate, cleanup } = useMemo(() => {
    return createSerializedTransaction(config)
  }, [config.mutationFn, config.metadata, config.strategy])

  // Cleanup on unmount or when dependencies change
  useEffect(() => {
    return () => cleanup()
  }, [cleanup])

  // Use useCallback to provide stable reference
  const stableMutate = useCallback(mutate, [mutate])

  return stableMutate
}
```

**Key fixes:**

- Include `config.strategy` in `useMemo` dependencies to handle strategy changes
- Properly cleanup when strategy changes (via useEffect cleanup)
- Return stable callback reference via `useCallback`

## Benefits

- ✅ Leverages battle-tested TanStack Pacer utilities
- ✅ Reduces backend write contention
- ✅ Framework-agnostic core promotes consistency
- ✅ Type-safe, composable API
- ✅ Aligns with TanStack ecosystem patterns
- ✅ Supports all 5 framework integrations
- ✅ Simple, declarative API for users
- ✅ Easy to add custom strategies

## Open Questions

1. Should we support custom strategies? (i.e., users passing their own strategy objects)
2. Do we need lifecycle callbacks like `onSuccess`, `onError` for each mutate call?
3. Should batching strategy automatically merge mutations or keep them separate?
4. Rate limiting strategy - useful or skip for now?

## Notes

- ❌ Dropped merge strategy for now (more complex to design, less clear use case)
- The pattern follows existing TanStack patterns where core is framework-agnostic
- Similar to how `useLiveQuery` wraps core query logic per framework
