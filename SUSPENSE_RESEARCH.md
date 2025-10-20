# TanStack DB Suspense Support Research

## Overview

This document contains research findings on how TanStack DB can support React Suspense, based on GitHub issue [#692](https://github.com/TanStack/db/issues/692).

## Issue Summary

**Request**: Add Suspense support to TanStack DB's React integration, similar to TanStack Query's `useSuspenseQuery` hook.

**Current Problem**:
- No way to handle data loading with React Suspense in `useLiveQuery`
- Reporter attempted to use `use(collection.preload())` but the promise never resolves
- Need either an opt-in option or a new `useLiveSuspenseQuery` hook

---

## React Suspense Fundamentals

### How Suspense Works

1. **Suspension Mechanism**:
   - Component "throws" a Promise during render
   - React catches the Promise and shows fallback UI
   - When Promise resolves, React retries rendering the component
   - Think of it as "try/catch" for asynchronous UI

2. **React 19 `use()` Hook**:
   ```jsx
   import { use, useMemo, Suspense } from 'react';

   function Component({ userId }) {
     const promise = useMemo(() => fetchUser(userId), [userId]);
     const data = use(promise);
     return <div>{data.name}</div>;
   }

   function App() {
     return (
       <Suspense fallback={<Loading />}>
         <Component userId="123" />
       </Suspense>
     );
   }
   ```

3. **Key Constraints**:
   - Cannot create promises during render - must be memoized
   - Promise must be stable across re-renders
   - Promise should resolve, not remain pending forever

4. **Benefits**:
   - Declarative loading states via Suspense boundaries
   - No manual `isLoading` checks in components
   - Better UX with streaming SSR
   - Coordinated loading states across multiple components

---

## TanStack Query's Suspense Pattern

### useSuspenseQuery API

```typescript
const { data } = useSuspenseQuery({
  queryKey: ['user', userId],
  queryFn: () => fetchUser(userId)
});
// data is ALWAYS defined (guaranteed by type system)
```

### Key Characteristics

1. **Type Safety**: `data` is guaranteed to be defined (never undefined)
2. **No Loading States**: `isLoading` doesn't exist - handled by Suspense
3. **Error Handling**: Errors throw to nearest Error Boundary
4. **Stale Data**: If cache has data, renders immediately (no suspend)
5. **Re-suspension**: Query key changes trigger new suspension

### Differences from useQuery

- No `enabled` option (can't conditionally disable)
- No `placeholderData` option
- No `isLoading` or `isError` states
- `status` is always `'success'` when rendered
- Re-suspends on query key changes (can use `startTransition` to prevent fallback)

---

## Current TanStack DB Implementation

### useLiveQuery Architecture

**File**: `/packages/react-db/src/useLiveQuery.ts`

```typescript
export function useLiveQuery(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  deps?: Array<unknown>
): {
  state: Map<string | number, GetResult<TContext>>
  data: InferResultType<TContext>
  collection: Collection<GetResult<TContext>, string | number, {}>
  status: CollectionStatus  // 'idle' | 'loading' | 'ready' | 'error' | 'cleaned-up'
  isLoading: boolean
  isReady: boolean
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
  isEnabled: boolean
}
```

**Key Implementation Details**:

1. Uses `useSyncExternalStore` for reactivity
2. Creates/reuses collections based on deps
3. Starts sync immediately via `startSyncImmediate()`
4. Returns multiple boolean flags for status

### Collection Lifecycle

**File**: `/packages/db/src/collection/index.ts`

**Status Flow**:
```
idle → loading → ready
  ↓               ↓
  → error     → cleaned-up
```

**Key Methods**:

1. **`startSyncImmediate()`**: Starts sync immediately
   ```typescript
   public startSyncImmediate(): void {
     this._sync.startSync()
   }
   ```

2. **`preload()`**: Returns promise that resolves when ready
   ```typescript
   public preload(): Promise<void> {
     return this._sync.preload()
   }
   ```

### Preload Implementation

**File**: `/packages/db/src/collection/sync.ts`

```typescript
public preload(): Promise<void> {
  if (this.preloadPromise) {
    return this.preloadPromise  // Share same promise across calls
  }

  this.preloadPromise = new Promise<void>((resolve, reject) => {
    if (this.lifecycle.status === `ready`) {
      resolve()
      return
    }

    if (this.lifecycle.status === `error`) {
      reject(new CollectionIsInErrorStateError())
      return
    }

    // Register callback BEFORE starting sync to avoid race condition
    this.lifecycle.onFirstReady(() => {
      resolve()
    })

    // Start sync if not already started
    if (
      this.lifecycle.status === `idle` ||
      this.lifecycle.status === `cleaned-up`
    ) {
      try {
        this.startSync()
      } catch (error) {
        reject(error)
        return
      }
    }
  })

  return this.preloadPromise
}
```

**How `onFirstReady` Works**:

**File**: `/packages/db/src/collection/lifecycle.ts`

```typescript
public onFirstReady(callback: () => void): void {
  // If already ready, call immediately
  if (this.hasBeenReady) {
    callback()
    return
  }

  this.onFirstReadyCallbacks.push(callback)
}

public markReady(): void {
  if (!this.hasBeenReady) {
    this.hasBeenReady = true

    const callbacks = [...this.onFirstReadyCallbacks]
    this.onFirstReadyCallbacks = []
    callbacks.forEach((callback) => callback())
  }
  // ...
}
```

**Critical Discovery**: The preload promise resolves ONLY when:
1. `markReady()` is called by the sync implementation
2. OR the collection is already in `ready` state

---

## Why `use(collection.preload())` Doesn't Work

### The Problem

The reporter tried:
```jsx
function Component() {
  const data = use(todosCollection.preload());
  // Promise never resolves
}
```

### Root Causes

1. **Promise Never Resolves**: If the sync function doesn't call `markReady()`, the preload promise waits forever
2. **Wrong Promise Type**: `preload()` returns `Promise<void>`, not the actual data
3. **Collection Already Created**: Using a pre-created collection means it might be in various states
4. **No Data Return**: Even if it resolves, it doesn't return the collection data

### What Would Be Needed

```jsx
// Pseudo-code for what's actually needed:
function useLiveSuspenseQuery(queryFn, deps) {
  const collection = /* create/get collection */;
  const promise = useMemo(() => {
    return collection.preload().then(() => collection.state);
  }, [collection]);

  const data = use(promise);
  // But this still has issues with re-renders and stability
}
```

---

## Design Approaches for Suspense Support

### Approach 1: New `useLiveSuspenseQuery` Hook

**Pros**:
- Clean separation of concerns
- Follows TanStack Query pattern
- Type-safe: data always defined
- No breaking changes to existing API

**Cons**:
- Code duplication with `useLiveQuery`
- More API surface area
- Users need to choose between two hooks

**Example API**:
```typescript
export function useLiveSuspenseQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  deps?: Array<unknown>
): {
  state: Map<string | number, GetResult<TContext>>
  data: InferResultType<TContext>  // ALWAYS defined, never undefined
  collection: Collection<GetResult<TContext>, string | number, {}>
  // No status, isLoading, isError - handled by Suspense/ErrorBoundary
}
```

### Approach 2: Add `suspense` Option to `useLiveQuery`

**Pros**:
- Single hook API
- Easier to migrate existing code
- Less code duplication

**Cons**:
- Complex type overloads
- Behavior changes based on option
- Harder to understand for users

**Example API**:
```typescript
// Without suspense
const { data, isLoading } = useLiveQuery(queryFn);

// With suspense
const { data } = useLiveQuery(queryFn, [], { suspense: true });
// data is guaranteed defined
```

### Approach 3: Collection-Level Preload Hook

**Pros**:
- Works with pre-created collections
- Minimal changes
- Progressive enhancement

**Cons**:
- Doesn't integrate with query builder pattern
- Less intuitive for new users
- Requires manual collection management

**Example API**:
```typescript
const todos = useCollectionSuspense(todosCollection);
// Suspends until collection is ready
```

---

## Recommended Approach

### Implementation: `useLiveSuspenseQuery` Hook

**Rationale**:
1. Follows established TanStack Query pattern
2. Type-safe by design
3. Clear mental model for users
4. No breaking changes
5. Can share code with `useLiveQuery` internally

### Implementation Plan

#### 1. Core Hook Signature

```typescript
// File: packages/react-db/src/useLiveSuspenseQuery.ts

export function useLiveSuspenseQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  deps?: Array<unknown>
): {
  state: Map<string | number, GetResult<TContext>>
  data: InferResultType<TContext>  // Never undefined
  collection: Collection<GetResult<TContext>, string | number, {}>
}
```

#### 2. Implementation Strategy

```typescript
import { use, useRef, useMemo } from 'react';
import { useLiveQuery } from './useLiveQuery';

export function useLiveSuspenseQuery(queryFn, deps = []) {
  // Create stable collection reference (reuse useLiveQuery logic)
  const collectionRef = useRef(null);
  const depsRef = useRef(null);

  // Detect if deps changed
  const needsNewCollection =
    !collectionRef.current ||
    (depsRef.current === null ||
      depsRef.current.length !== deps.length ||
      depsRef.current.some((dep, i) => dep !== deps[i]));

  if (needsNewCollection) {
    // Create new collection
    const queryBuilder = new BaseQueryBuilder();
    const result = queryFn(queryBuilder);

    if (result instanceof BaseQueryBuilder) {
      collectionRef.current = createLiveQueryCollection({
        query: queryFn,
        startSync: false,  // Don't start yet
        gcTime: 1,
      });
    }
    depsRef.current = [...deps];
  }

  const collection = collectionRef.current;

  // Create stable promise that resolves when collection is ready
  const promise = useMemo(() => {
    if (!collection) return Promise.resolve(null);

    if (collection.status === 'ready') {
      return Promise.resolve(collection);
    }

    if (collection.status === 'error') {
      return Promise.reject(new Error('Collection failed to load'));
    }

    // Start sync and wait for ready
    return collection.preload().then(() => collection);
  }, [collection]);

  // Suspend until ready
  const readyCollection = use(promise);

  if (!readyCollection) {
    throw new Error('Collection is null');
  }

  // Subscribe to changes (like useLiveQuery)
  const snapshot = useSyncExternalStore(
    (onStoreChange) => {
      const subscription = readyCollection.subscribeChanges(() => {
        onStoreChange();
      });
      return () => subscription.unsubscribe();
    },
    () => readyCollection.status
  );

  // Build return object
  const entries = Array.from(readyCollection.entries());
  const state = new Map(entries);
  const data = entries.map(([, value]) => value);

  return {
    state,
    data,
    collection: readyCollection,
  };
}
```

#### 3. Challenges to Solve

**Challenge 1: Re-suspending on Deps Change**

When deps change, we need to create a new collection. This should trigger a re-suspend.

**Solution**:
- Create new collection instance when deps change
- New collection starts in `idle` state
- `useMemo` creates new promise for new collection
- `use()` suspends on new promise

**Challenge 2: Promise Stability**

React's `use()` requires promises to be stable across re-renders within the same component lifecycle.

**Solution**:
- Use `useMemo` with collection as dependency
- Collection reference is stable unless deps change
- When deps change, we want a new promise anyway

**Challenge 3: Error Handling**

Errors should be thrown to Error Boundary.

**Solution**:
- Check collection status before creating promise
- Reject promise if status is `error`
- Let `use()` throw the rejection to Error Boundary

**Challenge 4: Preventing Fallback on Updates**

Like TanStack Query, we may want to prevent showing fallback when deps change.

**Solution** (Future Enhancement):
```jsx
import { startTransition } from 'react';

function TodoList({ filter }) {
  // Use startTransition when changing filter
  const handleFilterChange = (newFilter) => {
    startTransition(() => {
      setFilter(newFilter);
    });
  };

  // Won't show fallback during transition
  const { data } = useLiveSuspenseQuery(
    (q) => q.from({ todos }).where(({ todos }) => eq(todos.status, filter)),
    [filter]
  );
}
```

#### 4. Type Safety

```typescript
// Return type has NO optional properties
export function useLiveSuspenseQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  deps?: Array<unknown>
): {
  state: Map<string | number, GetResult<TContext>>
  data: InferResultType<TContext>  // Not `undefined | InferResultType`
  collection: Collection<GetResult<TContext>, string | number, {}>
  // NO status, isLoading, isReady, isError
}

// For single result queries
export function useLiveSuspenseQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext> & { findOne(): any },
  deps?: Array<unknown>
): {
  state: Map<string | number, GetResult<TContext>>
  data: GetResult<TContext>  // Single item, not array, not undefined
  collection: Collection<GetResult<TContext>, string | number, {}>
}
```

---

## Additional Considerations

### 1. Pre-created Collections

Should `useLiveSuspenseQuery` accept pre-created collections?

```typescript
const todos = createLiveQueryCollection(/* ... */);

// Option A: Not supported (compile error)
const { data } = useLiveSuspenseQuery(todos);

// Option B: Overload signature
export function useLiveSuspenseQuery<T>(
  collection: Collection<T>
): { data: T[], ... }
```

**Recommendation**: Support it with overload for consistency with `useLiveQuery`.

### 2. useLiveInfiniteQuery Suspense

Should there be `useLiveInfiniteSuspenseQuery`?

**Recommendation**: Yes, for consistency. Follow same pattern as `useLiveSuspenseQuery`.

### 3. Server-Side Rendering (SSR)

Suspense works great with SSR/streaming. Consider:

```tsx
// In TanStack Router loader
export const Route = createFileRoute('/todos')({
  loader: async () => {
    await todosCollection.preload();
  },
  component: TodosPage
});

function TodosPage() {
  // Data already loaded, no suspend on client
  const { data } = useLiveSuspenseQuery(
    (q) => q.from({ todos: todosCollection })
  );
}
```

### 4. DevTools Integration

TanStack DB DevTools should show:
- Which queries are suspended
- Why they're suspended (waiting for ready, error state, etc.)

### 5. Documentation Needs

1. **Migration Guide**: `useLiveQuery` → `useLiveSuspenseQuery`
2. **When to Use Which**: Decision tree for choosing hooks
3. **Error Boundaries**: How to set up proper error handling
4. **SSR/Streaming**: Integration with TanStack Router/Start
5. **Common Pitfalls**: Promise creation, deps management, etc.

---

## Testing Strategy

### Unit Tests

```typescript
describe('useLiveSuspenseQuery', () => {
  it('suspends while collection is loading', async () => {
    // Test that Suspense fallback is shown
  });

  it('renders data when collection is ready', async () => {
    // Test that data is available after suspend
  });

  it('throws to error boundary on collection error', async () => {
    // Test error handling
  });

  it('re-suspends when deps change', async () => {
    // Test deps reactivity
  });

  it('shares collection when deps are stable', async () => {
    // Test that collection isn't recreated unnecessarily
  });

  it('works with pre-created collections', async () => {
    // Test overload signature
  });
});
```

### Integration Tests

```typescript
describe('useLiveSuspenseQuery integration', () => {
  it('works with Suspense boundary', async () => {
    // Full rendering test with <Suspense>
  });

  it('works with Error boundary', async () => {
    // Full rendering test with ErrorBoundary
  });

  it('integrates with TanStack Router loader', async () => {
    // Test SSR preloading
  });
});
```

---

## Implementation Checklist

- [ ] Create `useLiveSuspenseQuery.ts` file
- [ ] Implement core hook logic
- [ ] Add TypeScript overloads for different return types
- [ ] Support pre-created collections
- [ ] Add proper error handling
- [ ] Write unit tests
- [ ] Write integration tests
- [ ] Add to exports in package.json
- [ ] Create documentation page
- [ ] Add examples to docs
- [ ] Update TypeScript docs generation
- [ ] Add DevTools integration
- [ ] Create migration guide
- [ ] Add changeset

---

## Examples

### Basic Usage

```tsx
import { Suspense } from 'react';
import { useLiveSuspenseQuery } from '@tanstack/react-db';
import { todosCollection } from './collections';

function TodoList() {
  const { data } = useLiveSuspenseQuery((q) =>
    q.from({ todos: todosCollection })
      .where(({ todos }) => eq(todos.completed, false))
  );

  return (
    <ul>
      {data.map(todo => (
        <li key={todo.id}>{todo.text}</li>
      ))}
    </ul>
  );
}

function App() {
  return (
    <Suspense fallback={<div>Loading todos...</div>}>
      <TodoList />
    </Suspense>
  );
}
```

### With Error Boundary

```tsx
import { ErrorBoundary } from 'react-error-boundary';

function App() {
  return (
    <ErrorBoundary fallback={<div>Failed to load todos</div>}>
      <Suspense fallback={<div>Loading todos...</div>}>
        <TodoList />
      </Suspense>
    </ErrorBoundary>
  );
}
```

### With Dependencies

```tsx
function FilteredTodoList({ filter }: { filter: string }) {
  const { data } = useLiveSuspenseQuery(
    (q) => q
      .from({ todos: todosCollection })
      .where(({ todos }) => eq(todos.status, filter)),
    [filter]  // Re-suspends when filter changes
  );

  return <ul>{/* ... */}</ul>;
}

// Prevent fallback during filter change
function TodoApp() {
  const [filter, setFilter] = useState('all');

  const handleFilterChange = (newFilter) => {
    startTransition(() => {
      setFilter(newFilter);
    });
  };

  return (
    <Suspense fallback={<Loading />}>
      <FilteredTodoList filter={filter} />
    </Suspense>
  );
}
```

### With TanStack Router

```tsx
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/todos')({
  // Preload in loader for SSR/instant navigation
  loader: async () => {
    await todosCollection.preload();
  },
  component: TodosPage,
});

function TodosPage() {
  // No suspend on first render if loader ran
  const { data } = useLiveSuspenseQuery((q) =>
    q.from({ todos: todosCollection })
  );

  return <TodoList todos={data} />;
}
```

---

## Open Questions

1. **Should `useLiveSuspenseQuery` support the `enabled` pattern?**
   - TanStack Query's `useSuspenseQuery` doesn't support `enabled`
   - Could conditionally return `null` query to achieve similar effect
   - Decision: Follow TanStack Query - no `enabled` support

2. **How to handle garbage collection with Suspense?**
   - Default `gcTime` is 1ms for `useLiveQuery`
   - Should Suspense queries have different gc behavior?
   - Decision: Keep same gc behavior for consistency

3. **Should we support `throwOnError` option?**
   - TanStack Query removed it from `useSuspenseQuery`
   - All errors throw to Error Boundary by default
   - Decision: No `throwOnError` option

4. **What about `staleTime` / `refetchInterval` equivalents?**
   - Collections sync continuously by default
   - No direct equivalent needed
   - Decision: Not applicable to DB's sync model

---

## References

- [GitHub Issue #692](https://github.com/TanStack/db/issues/692)
- [React Suspense Docs](https://react.dev/reference/react/Suspense)
- [React `use()` Hook](https://react.dev/reference/react/use)
- [TanStack Query Suspense Guide](https://tanstack.com/query/latest/docs/framework/react/guides/suspense)
- [TanStack Query useSuspenseQuery Reference](https://tanstack.com/query/latest/docs/framework/react/reference/useSuspenseQuery)

---

## Conclusion

**TanStack DB can effectively support Suspense** through a new `useLiveSuspenseQuery` hook that:

1. ✅ Leverages existing `preload()` infrastructure
2. ✅ Follows TanStack Query's established patterns
3. ✅ Provides type-safe API with guaranteed data
4. ✅ Integrates seamlessly with React 19's `use()` hook
5. ✅ Works with SSR/streaming via TanStack Router
6. ✅ Maintains backward compatibility

The main implementation challenge is ensuring **proper promise lifecycle management** and **stable references** across re-renders, which can be solved with careful use of `useMemo` and `useRef`.

**Next Steps**: Proceed with implementation of `useLiveSuspenseQuery` following the recommended approach outlined above.
