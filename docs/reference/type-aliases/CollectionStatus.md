---
id: CollectionStatus
title: CollectionStatus
---

```ts
type CollectionStatus = "idle" | "loading" | "ready" | "error" | "crashed" | "cleaned-up";
```

Defined in: [packages/db/src/types.ts:764](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L764)

Collection status values for lifecycle management

## Examples

```ts
// Check collection status
if (collection.status === "loading") {
  console.log("Collection is loading initial data")
} else if (collection.status === "ready") {
  console.log("Collection is ready for use")
}
```

```ts
// Status transitions
// idle → loading → ready (when markReady() is called)
// loading → error when the sync adapter calls fail() before the first ready
// any active status → crashed when local storage or an invariant breaks
// After the first ready, sync problems appear in `health`, not in `status`.
```
