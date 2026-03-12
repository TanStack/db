---
id: FieldPath
title: FieldPath
---

# Type Alias: FieldPath

```ts
type FieldPath = (string | number)[];
```

Defined in: [packages/db/src/query/expression-helpers.ts:39](https://github.com/TanStack/db/blob/main/packages/db/src/query/expression-helpers.ts#L39)

Represents a simple field path extracted from an expression.
Can include string keys for object properties and numbers for array indices.
