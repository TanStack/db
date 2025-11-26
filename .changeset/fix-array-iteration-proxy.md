---
"@tanstack/db": patch
---

Fix change tracking for array items accessed via iteration methods (find, forEach, for...of, etc.)

Previously, modifications to array items retrieved via iteration methods were not tracked by the change proxy because these methods returned raw array elements instead of proxied versions. This caused `getChanges()` to return an empty object, which in turn caused `createOptimisticAction`'s `mutationFn` to never be called when using patterns like:

```ts
collection.update(id, (draft) => {
  const item = draft.items.find((x) => x.id === targetId)
  if (item) {
    item.value = newValue // This change was not tracked!
  }
})
```

The fix adds proxy handling for array iteration methods similar to how Map/Set iteration is already handled, ensuring that callbacks receive proxied elements and returned elements are properly proxied.
