---
id: CleanupFn
title: CleanupFn
---

```ts
type CleanupFn = () => void | () => Promise<void>;
```

Defined in: [packages/db/src/types.ts:415](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L415)

Ends one sync run and releases its adapter-owned resources.

Collection cleanup waits for a returned promise before publishing the
`cleaned-up` status or admitting a replacement sync run.
TypeScript permits Promise-returning functions where `() => void` is
expected, so the Promise branch must be explicit here to preserve and await
it. Keeping the callable types separate also preserves contextual-void
callbacks that return an incidental value.
