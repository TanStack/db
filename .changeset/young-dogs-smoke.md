---
"@tanstack/db": minor
---

Fix transaction error handling to match documented behavior and preserve error identity

### Breaking Changes

- `commit()` now throws errors when the mutation function fails (previously returned a failed transaction)

### Bug Fixes

1. **Fixed commit() not throwing errors** - The `commit()` method now properly throws errors when the mutation function fails, matching the documented behavior. Both `await tx.commit()` and `await tx.isPersisted.promise` now work correctly in try/catch blocks.

### Migration Guide

If you were catching errors from `commit()` by checking the transaction state:

```js
// Before - commit() didn't throw
await tx.commit()
if (tx.state === "failed") {
  console.error("Failed:", tx.error)
}

// After - commit() now throws
try {
  await tx.commit()
} catch (error) {
  console.error("Failed:", error)
}
```
