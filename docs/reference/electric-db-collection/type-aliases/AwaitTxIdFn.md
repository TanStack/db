---
id: AwaitTxIdFn
title: AwaitTxIdFn
---

```ts
type AwaitTxIdFn = (txId, timeout?) => Promise<boolean>;
```

Defined in: [packages/electric-db-collection/src/electric.ts:873](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L873)

Type for the awaitTxId utility function. It resolves when the txid
appears in the Electric stream (the server's confirmation), before this
tab's persistence accepts the transaction. If that commit later rejects,
the source fails instead, and the Collection's health node records it
(maintainer decision on PR #2265).

## Parameters

### txId

[`Txid`](Txid.md)

### timeout?

`number`

## Returns

`Promise`\<`boolean`\>
