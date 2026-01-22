---
id: CollectionStatus
title: CollectionStatus
---

# Type Alias: CollectionStatus

```ts
type CollectionStatus = "idle" | "loading" | "ready" | "error" | "cleaned-up";
```

Defined in: [packages/db/src/types.ts:425](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L425)

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
// Any status can transition to → error or cleaned-up
```
