# Debugging Electric

Diagnose sync and txid issues.

## Enable Debug Logging

In browser console:

```javascript
localStorage.debug = 'ts/db:electric'
```

Uses the [debug](https://www.npmjs.com/package/debug) package. Refresh the page after setting.

## Common Debug Output

### Successful Txid Match

```
ts/db:electric awaitTxId called with txid 123
ts/db:electric new txids synced from pg [123]
ts/db:electric awaitTxId found match for txid 123
```

### Txid Mismatch (Common Bug)

```
ts/db:electric awaitTxId called with txid 124
ts/db:electric new txids synced from pg [123]
// Stalls forever - 124 never arrives!
```

**Cause**: Txid was queried outside the mutation transaction.

**Fix**: Query `pg_current_xact_id()` inside the same transaction as your mutation.

## Common Issues

### 1. awaitTxId Stalls/Times Out

**Symptom**: Mutation persists to database, but `awaitTxId` never resolves.

**Cause**: Txid returned from API doesn't match actual mutation transaction.

**Debug**:

```javascript
localStorage.debug = 'ts/db:electric'
// Watch for mismatch between requested txid and received txids
```

**Fix**:

```typescript
// WRONG - different transaction
async function createTodo(data) {
  const txid = await generateTxId(sql) // Separate transaction!
  await sql.begin(async (tx) => {
    await tx`INSERT INTO todos ${tx(data)}`
  })
  return { txid }
}

// CORRECT - same transaction
async function createTodo(data) {
  let txid!: number
  await sql.begin(async (tx) => {
    txid = await generateTxId(tx) // Same transaction!
    await tx`INSERT INTO todos ${tx(data)}`
  })
  return { txid }
}
```

### 2. Shape Not Syncing

**Symptom**: Collection stays empty or stale.

**Debug**:

1. Check browser Network tab for requests to your proxy
2. Verify proxy returns 200 status
3. Check proxy logs for errors

**Common causes**:

- Proxy authentication failing
- Electric service not running
- Shape configuration errors (invalid table/column names)

### 3. Optimistic Updates Flash

**Symptom**: Insert appears, disappears, then reappears.

**Cause**: Not waiting for sync before removing optimistic state.

**Fix**: Return `{ txid }` from mutation handlers or use `awaitMatch`:

```tsx
onInsert: async ({ transaction }) => {
  const response = await api.create(...)
  return { txid: response.txid }  // Wait for sync
}
```

### 4. awaitMatch Times Out

**Symptom**: Custom match function never finds a match.

**Debug**: Log incoming messages to verify your match logic:

```tsx
await collection.utils.awaitMatch((message) => {
  console.log('Received message:', message)
  return isChangeMessage(message) && message.value.id === expectedId
}, 10000)
```

**Common causes**:

- Wrong field names in match condition
- Message already arrived before `awaitMatch` was called
- Shape doesn't include the expected row

### 5. Connection Errors

**Symptom**: "Failed to fetch" or network errors.

**Debug**:

1. Verify Electric service is running
2. Check proxy URL is correct
3. Test proxy endpoint directly: `curl http://localhost:3000/api/todos`

## Network Tab Debugging

1. Open DevTools → Network
2. Filter by your proxy endpoint (e.g., `/api/todos`)
3. Check:
   - Request URL and params
   - Response status
   - Response body (should be Electric message stream)

## Logging in Handlers

Add logging to mutation handlers:

```tsx
onInsert: async ({ transaction }) => {
  console.log('[onInsert] Starting mutation:', transaction.mutations[0].modified)

  const response = await api.create(...)
  console.log('[onInsert] API response:', response)

  if (response.txid) {
    console.log('[onInsert] Waiting for txid:', response.txid)
  }

  return { txid: response.txid }
}
```

## Backend Logging

Log txid generation:

```typescript
async function generateTxId(tx: any): Promise<number> {
  const result = await tx`SELECT pg_current_xact_id()::xid::text as txid`
  const txid = parseInt(result[0]?.txid, 10)
  console.log('[generateTxId] Generated txid:', txid)
  return txid
}
```

## Collection State

Check collection state for errors:

```tsx
console.log(collection.state)
// {
//   isLoading: false,
//   isError: false,
//   error: undefined,
//   isSyncing: true
// }

if (collection.state.isError) {
  console.error('Collection error:', collection.state.error)
}
```

## Disable Debug Logging

```javascript
localStorage.removeItem('debug')
```

Or set to empty:

```javascript
localStorage.debug = ''
```

## Debug Namespace Patterns

Target specific areas:

```javascript
// All TanStack DB debug output
localStorage.debug = 'ts/db:*'

// Only Electric-specific
localStorage.debug = 'ts/db:electric'

// Multiple namespaces
localStorage.debug = 'ts/db:electric,ts/db:mutations'
```
