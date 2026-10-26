---
id: whenSyncAccepted
title: whenSyncAccepted
---

```ts
function whenSyncAccepted(receipt): SyncAppliedReceipt;
```

Defined in: [packages/db/src/sync-receipt.ts:32](https://github.com/TanStack/db/blob/main/packages/db/src/sync-receipt.ts#L32)

**`Internal`**

The moment a receipt's sync transaction was accepted. Handler-facing writes
and Collection readiness wait for this, not for visibility: a transaction held by a persisting
optimistic transaction becomes visible only when that transaction settles,
so a handler awaiting visibility would wait for itself. Core accepts at
`commit()`. A receipt that carries no acceptance moment is treated as
accepted only when it resolves.

 Adapter infrastructure, not an application API.

## Parameters

### receipt

[`SyncAppliedReceipt`](../type-aliases/SyncAppliedReceipt.md)

## Returns

[`SyncAppliedReceipt`](../type-aliases/SyncAppliedReceipt.md)
