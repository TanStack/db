---
id: SyncAppliedReceipt
title: SyncAppliedReceipt
---

# Type Alias: SyncAppliedReceipt

```ts
type SyncAppliedReceipt = true | Promise<void>;
```

Defined in: [packages/db/src/types.ts:354](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L354)

Confirms whether a committed sync transaction is visible or is waiting for
its turn in the collection's causal queue. A pending receipt rejects with an
error named `AbortError` if cancellation wins before application. Once the
writes are visible, later cancellation has no effect.
