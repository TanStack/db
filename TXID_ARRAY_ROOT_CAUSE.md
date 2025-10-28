# Root Cause Analysis: Array TxID Flicker Issue

## The Real Problem

After testing, I've confirmed the issue: **Both `{ txid: 123 }` and `{ txid: [123] }` work correctly when waiting for the correct txid.**

The flicker happens when the user is **waiting for the wrong txids**.

## User's Code Pattern

```typescript
onDelete: async ({ transaction }) => {
  const data = transaction.mutations.map((item) => item.modified.id);

  const txid = await Promise.all(
    data.map((item) => deleteContactSF({ data: { id: item } }))
  );

  return { txid: txid.map((item) => item.txid) };
}
```

## What's Actually Happening

### Scenario: `deleteContactSF` performs multiple operations

If the server function does:
1. Delete contact from database (txid: 123)
2. Log audit entry (txid: 124)
3. Returns `{ txid: 124 }` (only the audit log txid!)

Then the user's code returns `{ txid: [124] }`, and the sequence is:

1. **User deletes item** → Optimistic delete (item disappears from UI)
2. **Transaction starts persisting** → Waiting for txid 124
3. **Delete syncs from server** → txid 123 arrives, item confirmed deleted
4. **Transaction STILL waiting** → Because it's waiting for txid 124, not 123!
5. **Audit log insert syncs** → txid 124 arrives
   - If this somehow touches the same collection/key, it could cause an insert event
   - OR if there's any state manipulation, it could cause flicker
6. **Transaction completes** → Finally sees txid 124

### The Delete → Insert → Delete Pattern

Here's how the flicker manifests:

1. **Optimistic Delete** - Item removed from UI (user sees delete)
2. **Sync operations arrive while transaction is still "persisting"**
   - The transaction hasn't completed because it's waiting for txid 124
   - Meanwhile, the actual delete (txid 123) has synced
3. **When wrong txid arrives** - Transaction completes
   - This might trigger state recalculation
   - If there's any mismatch in optimistic vs synced state, it could cause intermediate events

## Test Results

My test `txid-wrong-value-bug.test.ts` shows:
```
Transaction state: persisting  (after actual delete synced!)
```

The transaction remains in "persisting" state even after the actual delete operation has synced, because it's waiting for a different txid.

## Why Single Txid "Works"

When the user returns `{ txid: result.txid }` directly:
- They're returning whatever single txid the server function returns
- If it's the correct delete txid (123), everything works
- If it's the wrong txid (124), it still might work better because there's less complexity

## The Real Bug

**The issue is NOT in TanStack DB's array handling.** The code correctly handles both single and array txids:

```typescript
// From electric.ts:508-512
if (Array.isArray(result.txid)) {
  await Promise.all(result.txid.map(awaitTxId))
} else {
  await awaitTxId(result.txid)
}
```

**The issue is in the USER'S CODE:**

1. They're calling `deleteContactSF` which might return a txid for a different operation
2. They're mapping over mutations even though there's only one
3. They're not ensuring they're waiting for the DELETE operation's txid specifically

## Solutions

### For the Discord User

**Option 1: Return the correct single txid**
```typescript
onDelete: async ({ transaction }) => {
  const mutation = transaction.mutations[0]
  const result = await deleteContactSF({ data: { id: mutation.original.id } })

  // Make sure deleteContactSF returns the DELETE operation's txid!
  return { txid: result.txid }
}
```

**Option 2: Ensure server function returns the delete txid**
If `deleteContactSF` performs multiple operations:
```typescript
// Server-side
async function deleteContactSF({ data }) {
  const deleteTxid = await db.contacts.delete(data.id)  // txid: 123
  await db.audit.log({ action: 'delete', id: data.id }) // txid: 124

  return { txid: deleteTxid }  // Return the DELETE txid, not audit log!
}
```

**Option 3: Wait for all related txids**
If you need to wait for both operations:
```typescript
onDelete: async ({ transaction }) => {
  const mutation = transaction.mutations[0]
  const result = await deleteContactSF({ data: { id: mutation.original.id } })

  // If server returns multiple txids
  if (Array.isArray(result.txids)) {
    return { txid: result.txids }  // Wait for all
  }

  return { txid: result.txid }
}
```

### For TanStack DB Maintainers

Consider adding:

1. **Debug logging** to help users understand which txids are being waited for
2. **Warning** when transaction is waiting for txids that seem unrelated to the operation
3. **Timeout warnings** that show which txids never arrived
4. **Documentation** clarifying that the txid should be for the PRIMARY operation, not side effects

## Conclusion

The array vs single txid is a red herring. The real issue is:
- **User is waiting for the wrong txid(s)**
- The delete operation's txid (123) is NOT in the array they're waiting for
- They're waiting for a side-effect operation's txid (124) instead
- This causes the transaction to remain "persisting" even after the delete has synced
- Leading to timing issues and potential state inconsistencies

**Recommendation**: Use single txid pattern and ensure it's the txid of the DELETE operation specifically.
