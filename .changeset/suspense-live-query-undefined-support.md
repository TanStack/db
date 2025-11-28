---
"@tanstack/react-db": patch
---

Improve error message when `useLiveSuspenseQuery` receives `undefined` from query callback.

Following TanStack Query's `useSuspenseQuery` design, `useLiveSuspenseQuery` intentionally does not support disabled queries (when callback returns `undefined` or `null`). This maintains the type guarantee that `data` is always `T` (not `T | undefined`), which is a core benefit of using Suspense.

**What changed:**

The error message is now more helpful and explains the design decision:

```
useLiveSuspenseQuery does not support disabled queries (callback returned undefined/null).
The Suspense pattern requires data to always be defined (T, not T | undefined).
Solutions:
1) Use conditional rendering - don't render the component until the condition is met.
2) Use useLiveQuery instead, which supports disabled queries with the 'isEnabled' flag.
```

**Why this matters:**

```typescript
// ❌ This pattern doesn't work with Suspense queries:
const { data } = useLiveSuspenseQuery(
  (q) => userId
    ? q.from({ users }).where(({ users }) => eq(users.id, userId)).findOne()
    : undefined,
  [userId]
)

// ✅ Instead, use conditional rendering:
function UserProfile({ userId }: { userId: string }) {
  const { data } = useLiveSuspenseQuery(
    (q) => q.from({ users }).where(({ users }) => eq(users.id, userId)).findOne(),
    [userId]
  )
  return <div>{data.name}</div> // data is guaranteed non-undefined
}

function App({ userId }: { userId?: string }) {
  if (!userId) return <div>No user selected</div>
  return <UserProfile userId={userId} />
}

// ✅ Or use useLiveQuery for conditional queries:
const { data, isEnabled } = useLiveQuery(
  (q) => userId
    ? q.from({ users }).where(({ users }) => eq(users.id, userId)).findOne()
    : undefined,
  [userId]
)
```

This aligns with TanStack Query's philosophy where Suspense queries prioritize type safety and proper component composition over flexibility.
