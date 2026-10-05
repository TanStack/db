---
id: SyncAppliedReceipt
title: SyncAppliedReceipt
---

```ts
type SyncAppliedReceipt = true | Promise<void>;
```

Defined in: [packages/db/src/types.ts:393](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L393)

Confirms whether a committed sync transaction is visible or is waiting for
its turn in the collection's causal queue. A pending receipt rejects with an
error named `AbortError` if its own cancellation wins before application or
cancellation removes a row required by one of its partial updates. It
rejects with `DuplicateKeySyncError` if cancellation of earlier queued work
invalidates an insert admission. Once the writes are visible, later
cancellation has no effect.
