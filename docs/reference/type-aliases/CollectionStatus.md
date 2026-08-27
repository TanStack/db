---
id: CollectionStatus
title: CollectionStatus
---

# Type Alias: CollectionStatus

```ts
type CollectionStatus = "idle" | "loading" | "ready" | "error" | "cleaned-up";
```

Defined in: [packages/db/src/types.ts:577](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L577)

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
// Any active status can transition to → error or cleaned-up
// error → ready after a successful sync recovery
```
