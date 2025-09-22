# Offline Transactions Race Condition Investigation

## Problem Description

### Symptoms
- `todoCollection.get()` and `todoCollection.update()` draft values are consistent with each other
- But these values differ from what's displayed on screen via `useLiveQuery`
- The issue manifests as UI showing stale data while collection methods work with current optimistic state

### Trigger Scenario
- Go offline and make changes to todos
- Go back online so transactions start executing
- During long-running `mutationFn` operations, the race condition appears
- Transactions get "stuck" in "persisting" state even after appearing to complete

## Root Cause Analysis

### Transaction Lifecycle Issue
The core problem involves transactions getting stuck in "persisting" state:

1. **Normal Flow**: `pending` → `persisting` → `completed` → optimistic state cleaned up
2. **Bug Flow**: `pending` → `persisting` → **STUCK** → optimistic state never cleaned up

### Technical Root Cause: `waitForTransactionCompletion` Hanging

In `packages/offline-transactions/src/OfflineExecutor.ts`:

```typescript
async waitForTransactionCompletion(transactionId: string): Promise<any> {
  return new Promise((resolve, reject) => {
    this.pendingTransactionPromises.set(transactionId, { resolve, reject })
  })
}
```

**The Problem**: This Promise only resolves when:
- `resolveTransaction()` is called (success)
- `rejectTransaction()` is called (permanent failure)

**Missing Case**: During retriable errors, the transaction enters retry loops but the Promise never gets resolved, causing:
- TanStack Transaction stuck in "persisting" state indefinitely
- Optimistic state from stuck transactions remains active
- `collection.get()` reads optimistic values correctly
- `useLiveQuery` shows stale snapshot because no change events are emitted

## Investigation Work Done

### 1. Comprehensive Logging Added

**Collection State Tracking** (`packages/db/src/collection.ts`):
```typescript
// Line ~775 - recomputeOptimisticState timing
console.log(`🔄 [${this.id}] recomputeOptimisticState START - triggeredByUserAction: ${triggeredByUserAction}, time: ${startTime}`)

// Line ~1053 - get() method optimistic reads
console.log(`🔍 [${this.id}] get(${key}) -> optimistic result:`, { completed: (result as any)?.completed })

// Line ~848 - emitEvents timing
console.log(`📤 [${this.id}] emitEvents called - changes: ${changes.length}, forceEmit: ${forceEmit}, shouldBatch: ${this.shouldBatchEvents}, time: ${performance.now()}`)

// Line ~2527 - transaction state changes
console.log(`🔄 [${this.id}] onTransactionStateChange called - pendingSyncTransactions: ${this.pendingSyncedTransactions.length}, time: ${performance.now()}`)

// Line ~1172 - commit pending transactions
console.log(`🔄 [${this.id}] commitPendingTransactions called - pendingSyncTransactions: ${this.pendingSyncedTransactions.length}, time: ${performance.now()}`)
```

**Live Query Capture Tracking** (`packages/react-db/src/useLiveQuery.ts`):
```typescript
// Line ~392 - subscription changes
console.log(`🔄 [useLiveQuery] subscribeChanges callback - bumping version to ${versionRef.current + 1}, time: ${performance.now()}`)

// Line ~472 - entry capturing
console.log(`📸 [useLiveQuery] capturing entries from collection ${snapshot.collection.id}, time: ${performance.now()}`)
console.log(`📋 [useLiveQuery] captured ${entries.length} entries:`, entries.map(([key, value]) => ({ key, completed: (value as any)?.completed })))
```

**Transaction State Transitions** (`packages/db/src/transactions.ts`):
```typescript
// Line ~257 - state changes
console.log(`🔄 [Transaction ${this.id.slice(0, 8)}] state change: ${oldState} → ${newState}, mutations: ${this.mutations.length}, time: ${performance.now()}`)
```

**Offline Executor Resolution** (`packages/offline-transactions/src/OfflineExecutor.ts`):
```typescript
// Line ~227 - transaction resolution
console.log(`resolving transaction`, { transactionId }, promise)
```

### 2. Key Findings

**Confirmed Issues**:
- Transactions do get stuck in "persisting" state
- `collection.get()` correctly reads from stuck transactions
- `useLiveQuery` shows outdated snapshot
- Promise resolution is working correctly when transactions do complete

**Transaction Retry Flow**:
```typescript
// In TransactionExecutor.executeTransaction():
try {
  await this.runMutationFn(transaction)
  this.offlineExecutor.resolveTransaction(transaction.id, result) // ✅ Success case
} catch (error) {
  if (!shouldRetry) {
    this.offlineExecutor.rejectTransaction(transaction.id, error) // ✅ Permanent failure
  } else {
    // ❌ MISSING: No resolution for retriable errors
    // Transaction enters retry loop, original Promise hangs forever
    await this.handleError(transaction, error)
  }
}
```

## Current Understanding

### Why Collection vs useLiveQuery Differ

1. **Collection.get()**: Always reads current optimistic state, including from stuck transactions
2. **useLiveQuery**: Captures snapshots when change events are emitted
3. **Stuck transactions**: Never complete → never call `touchCollection()` → no events emitted → stale snapshots

### State Consistency Issue

The system has **multiple sources of truth**:
- **Synced data**: Authoritative server state
- **Optimistic maps**: User changes and ongoing transactions
- **Live query snapshots**: Point-in-time captures for React rendering
- **Transaction registry**: Active transaction states

When transactions get stuck, these fall out of sync.

## Areas Investigated

### ✅ Confirmed Working
- Transaction Promise resolution mechanism (`resolveTransaction`/`rejectTransaction`)
- Collection optimistic state reading (`get()` method)
- Live query snapshot capturing (uses correct `entries()` → `get()` flow)
- Transaction state logging and visibility

### ❌ Root Issue Identified
- **waitForTransactionCompletion** hangs during retry scenarios
- Retriable errors don't resolve the original Promise
- TanStack Transactions stay in "persisting" state indefinitely

### 🔍 Additional Issues Found
- **Multiple mutate() calls**: Could create multiple TanStack Transactions with same ID (not current issue but should be fixed)
- **OutboxManager deserialization**: Happens frequently during retries but doesn't create new transactions

## Next Steps

### Immediate Fix Required
Modify `TransactionExecutor.executeTransaction()` to handle retriable errors properly:

**Option A**: Resolve immediately after first attempt
```typescript
} catch (error) {
  const shouldRetry = this.retryPolicy.shouldRetry(error, transaction.retryCount)
  if (!shouldRetry) {
    this.offlineExecutor.rejectTransaction(transaction.id, error)
  } else {
    // Resolve to allow TanStack transaction to complete
    // Keep optimistic state active while retries continue in background
    this.offlineExecutor.resolveTransaction(transaction.id, null)
  }
  await this.handleError(transaction, error)
}
```

**Option B**: Only resolve on final retry outcome
- Ensure retries actually complete and eventually call resolve/reject
- Add timeout or max retry safeguards
- Track why retries might run indefinitely

### Secondary Issues to Address
1. **Multiple mutate() prevention**: Add guards in `OfflineTransaction.mutate()`
2. **Transaction cleanup**: Ensure stuck transactions get cleaned up properly
3. **State reconciliation**: Add periodic sync between optimistic state and live queries

## Code Locations

### Key Files Modified
- `packages/db/src/collection.ts` - Collection state management and logging
- `packages/react-db/src/useLiveQuery.ts` - Live query snapshot capturing and logging
- `packages/db/src/transactions.ts` - Transaction state transitions and logging
- `packages/offline-transactions/src/OfflineExecutor.ts` - Promise resolution logging

### Key Methods Analyzed
- `Collection.get()` - Optimistic state reading
- `Collection.recomputeOptimisticState()` - Optimistic state calculation
- `Collection.emitEvents()` - Change event emission
- `useLiveQuery` snapshot capturing - Live query state capture
- `Transaction.commit()` - Transaction lifecycle
- `TransactionExecutor.executeTransaction()` - Offline transaction execution
- `OfflineExecutor.waitForTransactionCompletion()` - Promise coordination

## Debug Commands

### View Current State
```javascript
// In browser console:
todoCollection.transactions // See all active transactions
todoCollection.get("todo-id") // Check optimistic state
Array.from(todoCollection.entries()) // Check what useLiveQuery sees
```

### Trigger the Issue
1. Open DevTools → Network → Set to "Offline"
2. Add/modify todos (creates offline transactions)
3. Go back online
4. Observe stuck transactions in "persisting" state
5. Compare `todoCollection.get()` vs UI display

---

*Investigation conducted: September 2025*
*Status: Root cause identified, fix pending implementation*