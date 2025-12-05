---
"@tanstack/electric-db-collection": minor
---

feat(electric-db-collection): expose underlying ShapeStream via shapeStream getter

Added a `shapeStream` getter to `ElectricCollectionUtils` that allows users to access the underlying `ShapeStream` instance from an electric collection. This enables access to ShapeStream properties like the shape handle.

```typescript
const stream = collection.utils.shapeStream
if (stream) {
  console.log(stream.shapeHandle)
}
```
