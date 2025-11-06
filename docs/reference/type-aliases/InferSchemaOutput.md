---
id: InferSchemaOutput
title: InferSchemaOutput
---

# Type Alias: InferSchemaOutput\<T\>

```ts
type InferSchemaOutput<T> = T extends StandardSchemaV1 ? StandardSchemaV1.InferOutput<T> extends object ? StandardSchemaV1.InferOutput<T> : Record<string, unknown> : Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:44](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L44)

**`Internal`**

Helper type to extract the output type from a standard schema

 This is used by the type resolution system

## Type Parameters

### T

`T`
