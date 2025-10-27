# Analysis: Array of TxIDs Causing Flicker in Electric Collection

## Issue Summary

A Discord user reported that returning an array of txids from the `onDelete` handler causes a "delete → insert → delete" flicker pattern in React UI, while returning a single txid works correctly.

## User's Code Pattern

```typescript
onDelete: async ({ transaction }) => {
  const data = transaction.mutations.map((item) => item.modified.id);

  const txid = await Promise.all(
    data.map((item) => deleteContactSF({ data: { id: item } }))
  );

  return { txid: txid.map((item) => item.txid) }; // Returns { txid: [123] } for single delete
}
```

## Expected Pattern (From Documentation)

Looking at `packages/electric-db-collection/src/electric.ts:164-171`:

```typescript
// Basic Electric delete handler with txid (recommended)
onDelete: async ({ transaction }) => {
  const mutation = transaction.mutations[0]
  const result = await api.todos.delete({
    id: mutation.original.id
  })
  return { txid: result.txid } // Returns { txid: 123 }
}
```

## How TxID Matching Works

In `electric.ts:502-515`, the `processMatchingStrategy` function handles both patterns:

```typescript
const processMatchingStrategy = async (
  result: MatchingStrategy
): Promise<void> => {
  if (result && `txid` in result) {
    if (Array.isArray(result.txid)) {
      await Promise.all(result.txid.map(awaitTxId))  // For arrays
    } else {
      await awaitTxId(result.txid)  // For single txid
    }
  }
}
```

**Mathematically, these should be equivalent for a single txid:**
- `await awaitTxId(123)` ≡ `await Promise.all([awaitTxId(123)])`

## When to Use Array vs Single TxID

### ✅ Use Single TxID When:
- Deleting ONE item at a time
- Your server function returns one transaction ID
- Following the recommended pattern for simple operations

### ✅ Use Array of TxIDs When:
- Multiple mutations in a SINGLE transaction (rare for direct collection operations)
- Your server function performs multiple database transactions and returns multiple txids
- You need to wait for multiple related operations to sync

From `electric.ts:107-114` - the multi-item example:
```typescript
// Insert handler with multiple items - return array of txids
onInsert: async ({ transaction }) => {
  const items = transaction.mutations.map(m => m.modified)
  const results = await Promise.all(
    items.map(item => api.todos.create({ data: item }))
  )
  return { txid: results.map(r => r.txid) }  // Multiple txids
}
```

## Possible Causes of the Flicker

### Hypothesis 1: Server Function Returns Multiple TxIDs
If `deleteContactSF` performs multiple operations:
1. Delete contact (txid: 100)
2. Create audit log entry (txid: 101)

When waiting for both `[100, 101]`, the sync messages might arrive in this order:
1. Optimistic delete (contact disappears)
2. TxID 101 syncs first - INSERT event for audit log
3. If there's any mapping confusion, this could trigger an insert event
4. TxID 100 syncs - DELETE event
5. Result: delete → insert → delete flicker

### Hypothesis 2: Wrong TxIDs Being Returned
The user might be accidentally collecting txids from unrelated operations, causing the handler to wait for operations that don't match the actual delete.

### Hypothesis 3: Edge Case in Transaction Completion Timing
There may be a subtle race condition between:
- When the transaction state changes from `persisting` to `completed`
- When optimistic state is recomputed
- When pending sync transactions are committed

## Root Cause Analysis

The issue is likely **NOT** a bug in the electric-collection code itself, since:

1. The `processMatchingStrategy` function correctly handles both single and array txids
2. The `awaitTxId` function properly waits for each txid
3. Tests don't show this issue

The problem is most likely in **HOW** the user's `deleteContactSF` function works:

### Most Likely Cause
The user is mapping over mutations and calling `deleteContactSF` for each one:
```typescript
const txid = await Promise.all(
  data.map((item) => deleteContactSF({ data: { id: item } }))
);
```

**If `deleteContactSF` returns multiple txids per call**, the final result would be:
```typescript
// If deleteContactSF returns { txid: [100, 101] }
txid = [{ txid: [100, 101] }]  // Array of objects with txid arrays
txid.map((item) => item.txid) = [[100, 101]]  // Array of arrays!
```

This would cause `processMatchingStrategy` to call:
```typescript
await Promise.all([[100, 101]].map(awaitTxId))
// Which calls: awaitTxId([100, 101])  ❌ WRONG - expects a number!
```

This would throw an `ExpectedNumberInAwaitTxIdError` (see `electric.ts:355-357`).

BUT - the user didn't report an error, so this might not be it.

## Recommendations

### For the User

**Immediate Fix (Current Workaround):**
```typescript
onDelete: async ({ transaction }) => {
  // Get the first mutation
  const mutation = transaction.mutations[0]

  // Call delete function once
  const result = await deleteContactSF({ data: { id: mutation.original.id } })

  // Return single txid
  return { txid: result.txid }
}
```

**For Multiple Deletes in One Transaction:**
If you need to support batch deletes where `transaction.mutations.length > 1`:
```typescript
onDelete: async ({ transaction }) => {
  // Batch the IDs and make ONE server call
  const ids = transaction.mutations.map(m => m.original.id)
  const result = await deleteManyContactsSF({ data: { ids } })

  // Return single txid from the batch operation
  return { txid: result.txid }
}
```

### For TanStack DB Maintainers

1. **Add warning/validation** when array contains nested arrays
2. **Improve documentation** to clarify:
   - When to use single vs array of txids
   - Array should only contain numbers, not nested arrays
3. **Add debug logging** to help users understand what txids are being waited for
4. **Consider type safety** - make TypeScript catch `Array<Array<Txid>>` at compile time

## Why the Type System Allows Arrays

From `electric.ts:54-58`:
```typescript
/**
 * Matching strategies for Electric synchronization
 * Handlers can return:
 * - Txid strategy: { txid: number | number[] } (recommended)
 * - Void (no return value) - mutation completes without waiting
 */
export type MatchingStrategy = { txid: Txid | Array<Txid> } | void
```

The array option exists for legitimate use cases where:
1. A single mutation triggers multiple database transactions
2. You need to wait for all related transactions to complete before considering the operation "synced"
3. Complex workflows require coordination of multiple txids

## Conclusion

The user should use the single txid pattern for single-item deletes. The array pattern is designed for scenarios where one mutation genuinely produces multiple transaction IDs that all need to be awaited.

The flicker is likely caused by waiting for txids from unrelated operations or from a server function that performs multiple operations whose sync messages arrive out of order.
