# Bug Report: Issue #1122 - SyncTransactionAlreadyCommittedError in Progressive Mode

## Summary

This report documents the analysis and fix for GitHub Issue #1122, which describes `SyncTransactionAlreadyCommittedError` or `SyncTransactionAlreadyCommittedWriteError` occurring after browser visibility changes (tab switch, window minimize/restore) when using `electricCollectionOptions` with `syncMode: 'progressive'`.

## Bug Description

Users reported that after switching browser tabs and returning, the application would throw one of these errors:

```
SyncTransactionAlreadyCommittedError: The pending sync transaction is already committed, you can't commit it again.

SyncTransactionAlreadyCommittedWriteError: The pending sync transaction is already committed, you can't still write to it.
```

The error occurred because the `visibilityHandler` triggers `resume_fn`, which attempts to write to or commit a sync transaction that has already been committed.

## Root Cause Analysis

After extensive analysis of the codebase, two potential contributing issues were identified:

### Issue 1: Duplicate `begin()` Calls During Atomic Swap

In the atomic swap path (progressive mode's initial sync completion), there was a bug where `processMoveOutEvent` could call `begin()` again even though a transaction was already started.

**Problematic Code Flow:**

```typescript
// Atomic swap starts
begin()  // Creates transaction tx1, but transactionStarted is NOT set to true

// Later, for buffered move-out messages:
processMoveOutEvent(
  bufferedMsg.headers.patterns,
  begin,
  write,
  transactionStarted,  // This is false!
)
```

Since `transactionStarted` was `false` (it's never set in the atomic swap path), if `processMoveOutEvent` needed to delete rows, it would call `begin()` again, creating a second transaction. Only the last transaction would be committed, leaving the first one orphaned.

### Issue 2: `transactionStarted` Not Reset Before Commit

In the normal commit path, `transactionStarted` was reset to `false` AFTER `commit()`:

```typescript
if (transactionStarted) {
  commit()
  transactionStarted = false  // If commit() throws, this never executes!
}
```

If `commit()` threw an exception for any reason (not necessarily the "already committed" error), `transactionStarted` would remain `true`. On subsequent batches:

1. Change messages would see `transactionStarted = true`
2. They would skip calling `begin()`
3. They would try to `write()` to the already-committed transaction
4. `SyncTransactionAlreadyCommittedWriteError` would be thrown

Or:

1. `up-to-date` arrives
2. `transactionStarted` is `true`
3. `commit()` is called
4. The last transaction is already committed
5. `SyncTransactionAlreadyCommittedError` would be thrown

## The Fix

### Fix 1: Pass `true` to `processMoveOutEvent` During Atomic Swap

```typescript
} else if (isMoveOutMessage(bufferedMsg)) {
  // Process buffered move-out messages during atomic swap
  // Note: We pass `true` because a transaction was already started
  // at the beginning of the atomic swap (line 1454).
  // This prevents processMoveOutEvent from calling begin() again.
  processMoveOutEvent(
    bufferedMsg.headers.patterns,
    begin,
    write,
    true, // Transaction is already started in atomic swap
  )
}
```

### Fix 2: Reset `transactionStarted` BEFORE `commit()`

```typescript
if (transactionStarted) {
  // Reset transactionStarted before commit to prevent issues if commit throws.
  // If commit throws, we don't want transactionStarted to remain true,
  // as that would cause subsequent batches to skip begin() and try to use
  // an already-committed or non-existent transaction.
  transactionStarted = false
  commit()
}
```

## Additional Findings

### Orphaned Committed Transactions When Persisting Transaction Exists

During the investigation, it was discovered that when an optimistic (persisting) transaction exists, committed sync transactions are intentionally kept in `pendingSyncedTransactions` to avoid interference with optimistic mutations. This is by design and not a bug.

The `commitPendingTransactions()` function in `state.ts` has this logic:

```typescript
if (!hasPersistingTransaction || hasTruncateSync) {
  // Process transactions
}
```

This means committed sync transactions are only processed when:
- There's no persisting transaction, OR
- There's a truncate in the sync

The transactions are cleaned up when the persisting transaction completes, as `commitPendingTransactions()` is called from the transaction finalization flow.

## Test Coverage

The following test scenarios were added in `progressive-visibility-resume.test.ts`:

1. **Basic visibility resume after atomic swap** - Verifies no errors when receiving `up-to-date` after initial sync
2. **New changes after visibility resume** - Verifies new changes are processed correctly
3. **Duplicate messages during buffering phase** - Verifies handling of replayed messages
4. **Visibility change during active sync** - Verifies handling of visibility change mid-sync
5. **Move-out messages during atomic swap** - Verifies no duplicate `begin()` calls
6. **Double commit prevention** - Verifies no errors when multiple `up-to-date` messages arrive
7. **Sync messages while optimistic mutation is persisting** - Verifies correct behavior with concurrent optimistic mutations
8. **Multiple rapid visibility changes** - Stress test with rapid tab switching
9. **Up-to-date in separate batch** - Verifies handling of network delays
10. **Orphaned transaction cleanup** - Verifies transactions are properly cleaned up

## Files Modified

- `packages/electric-db-collection/src/electric.ts` - Bug fixes
- `packages/electric-db-collection/tests/progressive-visibility-resume.test.ts` - New test file

## Recommendations

1. **Consider adding defensive checks** - While the fix addresses the identified issues, consider adding more defensive checks for transaction state consistency.

2. **Review visibility handler behavior** - The Electric client's visibility handler behavior should be reviewed to understand exactly what happens during visibility changes.

3. **Add more logging** - Consider adding debug logging for transaction state transitions to help diagnose similar issues in the future.

4. **Document transaction lifecycle** - The sync transaction lifecycle is complex, especially in progressive mode. Better documentation would help prevent similar issues.

## Conclusion

The bug was caused by a combination of:
1. Improper `transactionStarted` state management during atomic swap
2. Risk of `transactionStarted` remaining stale if `commit()` throws

The fix ensures:
1. No duplicate `begin()` calls during atomic swap
2. `transactionStarted` is always reset before `commit()` to prevent stale state

All existing tests pass and new comprehensive test coverage has been added for visibility resume scenarios.
