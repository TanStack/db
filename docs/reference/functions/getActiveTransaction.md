---
id: getActiveTransaction
title: getActiveTransaction
---

# Function: getActiveTransaction()

```ts
function getActiveTransaction(): 
  | Transaction<Record<string, unknown>>
  | undefined;
```

Defined in: packages/db/src/transactions.ts:175

Gets the currently active ambient transaction, if any
Used internally by collection operations to join existing transactions

## Returns

  \| [`Transaction`](../interfaces/Transaction.md)\<`Record`\<`string`, `unknown`\>\>
  \| `undefined`

The active transaction or undefined if none is active

## Example

```ts
// Check if operations will join an ambient transaction
const ambientTx = getActiveTransaction()
if (ambientTx) {
  console.log('Operations will join transaction:', ambientTx.id)
}
```
