---
id: SyncAppliedReceipt
title: SyncAppliedReceipt
---

```ts
type SyncAppliedReceipt = true | Promise<void>;
```

Defined in: [packages/db/src/types.ts:390](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L390)

Confirms that a committed sync transaction is visible, or resolves when it
becomes visible. An accepted transaction always applies in commit order. A
receipt rejects with an error named `AbortError` only if its signal aborted
before acceptance, or if cleanup abandons the transaction.
