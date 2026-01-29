---
id: InferSchemaInput
title: InferSchemaInput
---

# Type Alias: InferSchemaInput\<T\>

```ts
type InferSchemaInput<T> = T extends StandardSchemaV1 ? StandardSchemaV1.InferInput<T> extends object ? StandardSchemaV1.InferInput<T> : Record<string, unknown> : Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:56](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L56)

**`Internal`**

Helper type to extract the input type from a standard schema

 This is used for collection insert type inference

## Type Parameters

### T

`T`
