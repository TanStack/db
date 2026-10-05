---
id: withAcceptedReceipt
title: withAcceptedReceipt
---

```ts
function withAcceptedReceipt(visible, accepted): Promise<void>;
```

Defined in: [packages/db/src/sync-receipt.ts:14](https://github.com/TanStack/db/blob/main/packages/db/src/sync-receipt.ts#L14)

**`Internal`**

Attaches the moment a sync transaction was accepted to the receipt that
resolves when it is visible. A wrapping sync, such as persistence, accepts
after its durable step.

 Adapter infrastructure, not an application API.

## Parameters

### visible

`Promise`\<`void`\>

### accepted

[`SyncAppliedReceipt`](../type-aliases/SyncAppliedReceipt.md)

## Returns

`Promise`\<`void`\>
