---
"@tanstack/react-db": patch
---

Expand `useLiveQuery` callback to support conditional queries and additional return types, enabling the ability to temporarily disable the query.

**New Features:**

- Callback can now return `undefined` or `null` to temporarily disable the query
- Callback can return a pre-created `Collection` instance to use it directly
- Callback can return a `LiveQueryCollectionConfig` object for advanced configuration
- When disabled (returning `undefined`/`null`), the hook returns a specific idle state

**Usage Examples:**

```ts
// Conditional queries - disable when not ready
const enabled = useState(false)
const { data, state, isIdle } = useLiveQuery((q) => {
  if (!enabled) return undefined  // Disables the query
  return q.from({ users }).where(...)
}, [enabled])

/**
 * When disabled, returns:
 * {
 *   state: undefined,
 *   data: undefined,
 *   isIdle: true,
 *   ...
 * }
 */

// Return pre-created Collection
const { data } = useLiveQuery((q) => {
  if (usePrebuilt) return myCollection  // Use existing collection
  return q.from({ items }).select(...)
}, [usePrebuilt])

// Return LiveQueryCollectionConfig
const { data } = useLiveQuery((q) => {
  return {
    query: q.from({ items }).select(...),
    id: `my-collection`,
  }
})
```
