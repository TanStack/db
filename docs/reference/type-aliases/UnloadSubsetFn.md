---
id: UnloadSubsetFn
title: UnloadSubsetFn
---

# Type Alias: UnloadSubsetFn()

```ts
type UnloadSubsetFn = (options) => void;
```

Defined in: [packages/db/src/types.ts:378](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L378)

Releases the exact acquisition created for `options`.

Implementations must be idempotent and must not throw. An adapter owns any
remote unsubscribe retry needed to make release reliable. Core attempts
each acquisition's release once, reports failures, and continues retiring
other acquisitions. It does not retry a failed subset release.

## Parameters

### options

[`LoadSubsetOptions`](LoadSubsetOptions.md)

## Returns

`void`
